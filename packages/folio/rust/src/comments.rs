//! Bounded page-owned PDF reply/review graph. Metadata is caller supplied, never a clock/identity guess.
use super::*;
use std::collections::{BTreeMap, BTreeSet};
const PAGE_CAP: usize = 4096;
const THREAD_CAP: usize = 256;
const DEPTH_CAP: usize = 64;
#[derive(Clone)]
struct Node {
    id: ObjectId,
    parent: Option<ObjectId>,
    body: String,
    subtype: String,
    rect: Option<[f64; 4]>,
    author: Option<String>,
    modified: Option<String>,
    state: Option<String>,
    model: Option<String>,
}
struct Graph {
    nodes: BTreeMap<ObjectId, Node>,
    order: Vec<ObjectId>,
    roots: BTreeMap<ObjectId, ObjectId>,
}
fn invalid(s: &str) -> EngineError {
    EngineError::validation(s)
}
fn decoded(dict: &lopdf::Dictionary, key: &[u8]) -> Result<Option<String>, EngineError> {
    match dict.get(key) {
        Ok(o) => Ok(Some(lopdf::decode_text_string(o).map_err(ser_err)?)),
        Err(lopdf::Error::DictKey(_)) => Ok(None),
        Err(e) => Err(ser_err(e)),
    }
}
fn date_valid(date: &str) -> bool {
    let b = date.as_bytes();
    if b.len() != 17
        || !b.starts_with(b"D:")
        || b[16] != b'Z'
        || !b[2..16].iter().all(u8::is_ascii_digit)
    {
        return false;
    }
    let number = |a, b| date[a..b].parse::<u32>().unwrap();
    let y = number(2, 6);
    let m = number(6, 8);
    let d = number(8, 10);
    let days = match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) {
                29
            } else {
                28
            }
        }
        _ => return false,
    };
    y > 0 && d > 0 && d <= days && number(10, 12) < 24 && number(12, 14) < 60 && number(14, 16) < 60
}
pub(super) fn metadata(p: &Value) -> Result<(String, String), EngineError> {
    let author = req_str(p, "author")?;
    let modified = req_str(p, "modified")?;
    if author.trim().is_empty()
        || author.len() > 256
        || author.chars().any(char::is_control)
        || !date_valid(modified)
    {
        return Err(invalid("author must be nonblank bounded text and modified a full valid UTC PDF date D:YYYYMMDDHHmmSSZ"));
    }
    Ok((author.into(), modified.into()))
}
fn strict_ids(doc: &Document, page: ObjectId) -> Result<Vec<ObjectId>, EngineError> {
    let array = match annots_loc(doc, page)? {
        AnnotsLoc::Missing => return Ok(vec![]),
        AnnotsLoc::Inline => doc
            .get_object(page)
            .and_then(Object::as_dict)
            .and_then(|d| d.get(b"Annots"))
            .and_then(Object::as_array),
        AnnotsLoc::Ref(id) => doc.get_object(id).and_then(Object::as_array),
    }
    .map_err(ser_err)?;
    if array.len() > PAGE_CAP {
        return Err(invalid("comment page exceeds 4096 annotations"));
    }
    let mut seen = BTreeSet::new();
    let mut ids = Vec::new();
    for object in array {
        let id = object.as_reference().map_err(ser_err)?;
        if !seen.insert(id.0) {
            return Err(invalid("duplicate page annotation reference"));
        }
        ids.push(id);
    }
    Ok(ids)
}
impl Graph {
    fn read(doc: &Document, page: ObjectId) -> Result<Self, EngineError> {
        let ids = strict_ids(doc, page)?;
        let mut nodes = BTreeMap::new();
        let mut order = vec![];
        for id in ids {
            let d = doc
                .get_object(id)
                .and_then(Object::as_dict)
                .map_err(ser_err)?;
            let subtype = d
                .get(b"Subtype")
                .and_then(Object::as_name)
                .map_err(ser_err)?;
            if subtype != b"Text" && subtype != b"Highlight" {
                if d.has(b"IRT") || d.has(b"RT") {
                    return Err(EngineError::unsupported(
                        "unsupported non-comment reply relationship",
                    ));
                }
                if let Ok(p) = d.get(b"P") {
                    if p.as_reference().map_err(ser_err)? != page {
                        return Err(invalid("annotation page reference mismatch"));
                    }
                }
                nodes.insert(
                    id,
                    Node {
                        id,
                        parent: None,
                        body: String::new(),
                        subtype: String::from_utf8_lossy(subtype).into_owned(),
                        rect: None,
                        author: None,
                        modified: None,
                        state: None,
                        model: None,
                    },
                );
                order.push(id);
                continue;
            }
            if let Ok(p) = d.get(b"P") {
                if p.as_reference().map_err(ser_err)? != page {
                    return Err(invalid("annotation page reference mismatch"));
                }
            }
            let rect = d
                .get(b"Rect")
                .ok()
                .and_then(|v| v.as_array().ok())
                .filter(|v| v.len() == 4)
                .and_then(|v| {
                    let x = obj_f64(&v[0])?;
                    let y = obj_f64(&v[1])?;
                    let x2 = obj_f64(&v[2])?;
                    let y2 = obj_f64(&v[3])?;
                    [x, y, x2, y2]
                        .iter()
                        .all(|v| v.is_finite())
                        .then_some([x, y, x2 - x, y2 - y])
                });
            let parent = match d.get(b"IRT") {
                Ok(p) => Some(p.as_reference().map_err(ser_err)?),
                Err(_) => None,
            };
            if let Ok(rt) = d.get(b"RT") {
                if parent.is_none() || rt.as_name().map_err(ser_err)? != b"R" {
                    return Err(EngineError::unsupported(
                        "only textual reply RT R is admitted",
                    ));
                }
            }
            let body = decoded(d, b"Contents")?.unwrap_or_default();
            if body.encode_utf16().count() > 32767 {
                return Err(invalid("comment body exceeds 64 KiB UTF-16 budget"));
            }
            let author = decoded(d, b"T")?;
            if author
                .as_ref()
                .is_some_and(|a| a.len() > 256 || a.chars().any(char::is_control))
            {
                return Err(invalid("invalid annotation author"));
            }
            let modified = decoded(d, b"M")?;
            if modified.as_ref().is_some_and(|date| !date_valid(date)) {
                return Err(EngineError::unsupported(
                    "comment projection requires full UTC PDF dates",
                ));
            }
            let state = decoded(d, b"State")?;
            let model = decoded(d, b"StateModel")?;
            if state.is_some() != model.is_some()
                || state.is_some()
                    && (subtype != b"Text"
                        || parent.is_none()
                        || author.as_ref().is_none_or(|a| a.trim().is_empty())
                        || modified.is_none())
            {
                return Err(invalid(
                    "state records require a Text reply with author and date",
                ));
            }
            if state.is_some() && !body.is_empty() {
                return Err(EngineError::unsupported(
                    "state records with comment text need explicit separate handling",
                ));
            }
            if let (Some(state), Some(model)) = (&state, &model) {
                if model != "Review"
                    || !matches!(
                        state.as_str(),
                        "Accepted" | "Rejected" | "Cancelled" | "Completed" | "None"
                    )
                {
                    return Err(EngineError::unsupported(
                        "unsupported annotation state model/value",
                    ));
                }
            }
            nodes.insert(
                id,
                Node {
                    id,
                    parent,
                    body,
                    subtype: String::from_utf8_lossy(subtype).into_owned(),
                    rect,
                    author,
                    modified,
                    state,
                    model,
                },
            );
            order.push(id);
        }
        let pages = doc.get_pages();
        if pages.len() > 10_000 {
            return Err(invalid("comment ownership scan exceeds 10000 pages"));
        }
        let mut references = 0usize;
        let mut memberships = BTreeMap::<ObjectId, usize>::new();
        for owner in pages.values() {
            let ids = strict_ids(doc, *owner)?;
            references = references
                .checked_add(ids.len())
                .filter(|n| *n <= 100_000)
                .ok_or_else(|| {
                    invalid("comment ownership scan exceeds 100000 annotation references")
                })?;
            for id in ids {
                if nodes.contains_key(&id) {
                    let count = memberships.entry(id).or_default();
                    *count += 1;
                    if *owner != page || *count > 1 {
                        return Err(invalid(
                            "comment object is shared across page annotation arrays",
                        ));
                    }
                }
            }
        }
        if nodes.keys().any(|id| memberships.get(id) != Some(&1)) {
            return Err(invalid("comment has no unique page ownership"));
        }
        if doc.objects.len() > 100_000 {
            return Err(invalid("comment graph scan exceeds 100000 PDF objects"));
        }
        for (id, object) in &doc.objects {
            if let Ok(dict) = object.as_dict() {
                if let Ok(parent) = dict.get(b"IRT") {
                    if parent
                        .as_reference()
                        .is_ok_and(|parent| nodes.contains_key(&parent))
                        && !nodes.contains_key(id)
                    {
                        return Err(invalid("cross-page, orphan or unsupported incoming reply"));
                    }
                }
            }
        }
        for node in nodes.values().filter(|node| node.state.is_some()) {
            let parent = nodes
                .get(&node.parent.unwrap())
                .ok_or_else(|| invalid("missing state target"))?;
            if parent.parent.is_some() && (parent.state.is_none() || parent.author != node.author) {
                return Err(EngineError::unsupported(
                    "review state must follow primary or same-author state chain",
                ));
            }
        }
        let mut roots = BTreeMap::new();
        let mut counts = BTreeMap::<ObjectId, usize>::new();
        for id in &order {
            let mut current = *id;
            let mut seen = BTreeSet::new();
            for _ in 0..=DEPTH_CAP {
                if !seen.insert(current) {
                    return Err(invalid("cyclic annotation reply graph"));
                }
                let n = nodes
                    .get(&current)
                    .ok_or_else(|| invalid("dangling, unsupported or cross-page reply target"))?;
                if let Some(parent) = n.parent {
                    current = parent;
                } else {
                    roots.insert(*id, current);
                    break;
                }
            }
            if !roots.contains_key(id) {
                return Err(invalid("reply depth exceeds 64"));
            }
            let count = counts.entry(roots[id]).or_default();
            *count += 1;
            if *count > THREAD_CAP {
                return Err(invalid("comment thread exceeds 256 records"));
            }
        }
        Ok(Self {
            nodes,
            order,
            roots,
        })
    }
    fn target(&self, id: u64) -> Result<ObjectId, EngineError> {
        self.order
            .iter()
            .find(|o| u64::from(o.0) == id)
            .copied()
            .ok_or_else(|| EngineError::not_found("page-owned comment not found"))
    }
    fn latest(&self, root: ObjectId, author: &str) -> Option<&Node> {
        self.order
            .iter()
            .filter_map(|id| self.nodes.get(id))
            .filter(|n| {
                self.roots[&n.id] == root
                    && n.model.as_deref() == Some("Review")
                    && n.author.as_deref() == Some(author)
            })
            .max_by_key(|n| (n.modified.as_deref().unwrap_or(""), n.id))
    }
}
fn push(doc: &mut Document, page: ObjectId, id: ObjectId) -> Result<(), EngineError> {
    match annots_loc(doc, page)? {
        AnnotsLoc::Inline => doc
            .get_object_mut(page)
            .and_then(Object::as_dict_mut)
            .and_then(|d| d.get_mut(b"Annots"))
            .and_then(Object::as_array_mut)
            .map_err(ser_err)?
            .push(Object::Reference(id)),
        AnnotsLoc::Ref(array) => doc
            .get_object_mut(array)
            .and_then(Object::as_array_mut)
            .map_err(ser_err)?
            .push(Object::Reference(id)),
        AnnotsLoc::Missing => doc
            .get_object_mut(page)
            .and_then(Object::as_dict_mut)
            .map_err(ser_err)?
            .set("Annots", vec![Object::Reference(id)]),
    }
    Ok(())
}
fn entry(n: &Node) -> Value {
    let mut v = json!({"id":n.id.0,"contents":n.body});
    if let Some(a) = &n.author {
        v["author"] = json!(a);
    }
    if let Some(m) = &n.modified {
        v["modified"] = json!(m);
    }
    v
}
pub(super) fn references_removed(
    object: &Object,
    remove: &BTreeSet<ObjectId>,
    depth: usize,
    work: &mut usize,
) -> Result<bool, EngineError> {
    *work += 1;
    if depth > 64 || *work > 1_000_000 {
        return Err(invalid("annotation reference scan budget exceeded"));
    }
    match object {
        Object::Reference(id) => Ok(remove.contains(id)),
        Object::Array(items) => {
            for item in items {
                if references_removed(item, remove, depth + 1, work)? {
                    return Ok(true);
                }
            }
            Ok(false)
        }
        Object::Dictionary(dict) => {
            for (_, value) in dict.iter() {
                if references_removed(value, remove, depth + 1, work)? {
                    return Ok(true);
                }
            }
            Ok(false)
        }
        Object::Stream(stream) => {
            for (_, value) in stream.dict.iter() {
                if references_removed(value, remove, depth + 1, work)? {
                    return Ok(true);
                }
            }
            Ok(false)
        }
        _ => Ok(false),
    }
}
impl FolioEngine {
    pub(super) fn op_list_comment_threads(&self, p: &Value) -> Result<CommandResult, EngineError> {
        reject_encrypted(&self.doc, "comment thread listing")?;
        let page = self.page_id(req_u64(p, "page")?)?;
        let graph = Graph::read(&self.doc, page)?;
        let review_author = match p.get("review_author") {
            Some(v) => Some(
                v.as_str()
                    .ok_or_else(|| invalid("review_author must be a string"))?,
            ),
            None => None,
        };
        if review_author.is_some_and(|author| {
            author.trim().is_empty() || author.len() > 256 || author.chars().any(char::is_control)
        }) {
            return Err(invalid("invalid review author"));
        }
        let mut threads = vec![];
        for id in &graph.order {
            let n = &graph.nodes[id];
            if n.parent.is_some() || !matches!(n.subtype.as_str(), "Text" | "Highlight") {
                continue;
            }
            let mut thread = entry(n);
            thread["subtype"] = json!(n.subtype);
            thread["rect"] = json!(n.rect);
            let replies: Vec<_> = graph
                .order
                .iter()
                .filter_map(|r| {
                    let reply = &graph.nodes[r];
                    (reply.parent.is_some() && reply.state.is_none() && graph.roots[r] == *id)
                        .then(|| entry(reply))
                })
                .collect();
            thread["replies"] = json!(replies);
            if let Some(author) = review_author {
                let state = graph
                    .latest(*id, author)
                    .and_then(|n| n.state.as_deref())
                    .unwrap_or("None");
                thread["review_state"] = json!(state);
                if matches!(state, "Completed" | "None") {
                    thread["resolved"] = json!(state == "Completed");
                }
            }
            threads.push(thread);
        }
        Ok(ro(json!({"threads":threads})))
    }
    pub(super) fn op_comment_reply(
        &mut self,
        p: &Value,
        review: bool,
    ) -> Result<CommandResult, EngineError> {
        reject_encrypted(&self.doc, "comment reply/review")?;
        let page = self.page_id(req_u64(p, "page")?)?;
        let graph = Graph::read(&self.doc, page)?;
        let root = graph.target(req_u64(p, "id")?)?;
        if !matches!(graph.nodes[&root].subtype.as_str(), "Text" | "Highlight") {
            return Err(EngineError::unsupported(
                "reply/review supports Text/Highlight primaries only",
            ));
        }
        if graph.nodes[&root].parent.is_some() {
            return Err(invalid("reply/resolve target must be a primary comment"));
        }
        let (author, modified) = metadata(p)?;
        let (state, contents, parent) = if review {
            let resolved = field(p, "resolved")?
                .as_bool()
                .ok_or_else(|| invalid("resolved must be boolean"))?;
            let state = if resolved { "Completed" } else { "None" };
            let latest = graph.latest(root, &author);
            if latest.and_then(|n| n.state.as_deref()).unwrap_or("None") == state {
                return Ok(ro(json!({"ok":true})));
            }
            if latest.is_some_and(|n| n.modified.as_deref().unwrap_or("") > modified.as_str()) {
                return Err(invalid("review date precedes latest author state"));
            }
            (Some(state), "", latest.map_or(root, |n| n.id))
        } else {
            let contents = req_str(p, "contents")?;
            if contents.trim().is_empty() || contents.encode_utf16().count() > 32767 {
                return Err(invalid(
                    "reply body must be nonblank and at most 32767 UTF-16 units",
                ));
            }
            (None, contents, root)
        };
        let mut next = self.doc.clone();
        let mut d = dictionary! {"Type"=>"Annot","Subtype"=>"Text","P"=>Object::Reference(page),"Rect"=>vec![Object::Integer(0);4],"IRT"=>Object::Reference(parent),"RT"=>"R","T"=>lopdf::text_string(&author),"M"=>lopdf::text_string(&modified),"CreationDate"=>lopdf::text_string(&modified),"Contents"=>lopdf::text_string(contents)};
        if let Some(state) = state {
            d.set("State", lopdf::text_string(state));
            d.set("StateModel", lopdf::text_string("Review"));
            d.set("F", 2);
        }
        let next_id = next
            .max_id
            .checked_add(1)
            .ok_or_else(|| invalid("PDF object id space exhausted"))?;
        if next.objects.contains_key(&(next_id, 0)) {
            return Err(invalid("PDF object id collision"));
        }
        let id = next.add_object(d);
        push(&mut next, page, id)?;
        Graph::read(&next, page)?;
        self.journal.record(self.doc.clone());
        self.doc = next;
        Ok(CommandResult::data(json!({"annot_id":id.0})))
    }
    pub(super) fn op_remove_comment_tree(
        &mut self,
        p: &Value,
    ) -> Result<CommandResult, EngineError> {
        reject_encrypted(&self.doc, "annotation deletion")?;
        let page = self.page_id(req_u64(p, "page")?)?;
        let graph = Graph::read(&self.doc, page)?;
        let target = graph.target(req_u64(p, "id")?)?;
        let mut remove = BTreeSet::from([target]);
        loop {
            let before = remove.len();
            for node in graph.nodes.values() {
                if node.parent.is_some_and(|p| remove.contains(&p)) {
                    remove.insert(node.id);
                }
            }
            if remove.len() == before {
                break;
            }
        }
        for id in &remove {
            let dict = self
                .doc
                .get_object(*id)
                .and_then(Object::as_dict)
                .map_err(ser_err)?;
            if dict.has(b"Popup") {
                return Err(EngineError::unsupported(
                    "popup annotation deletion is not admitted",
                ));
            }
        }
        let annots_array = match annots_loc(&self.doc, page)? {
            AnnotsLoc::Ref(id) => Some(id),
            _ => None,
        };
        let mut work = 0usize;
        for (id, object) in &self.doc.objects {
            if remove.contains(id) || Some(*id) == annots_array {
                continue;
            }
            if *id == page {
                let dict = object.as_dict().map_err(ser_err)?;
                for (key, value) in dict.iter() {
                    if key.as_slice() != b"Annots"
                        && references_removed(value, &remove, 0, &mut work)?
                    {
                        return Err(EngineError::unsupported(
                            "external reference prevents annotation deletion",
                        ));
                    }
                }
            } else if references_removed(object, &remove, 0, &mut work)? {
                return Err(EngineError::unsupported(
                    "external reference prevents annotation deletion",
                ));
            }
        }
        let mut next = self.doc.clone();
        match annots_loc(&next, page)? {
            AnnotsLoc::Inline => next
                .get_object_mut(page)
                .and_then(Object::as_dict_mut)
                .and_then(|d| d.get_mut(b"Annots"))
                .and_then(Object::as_array_mut)
                .map_err(ser_err)?
                .retain(|o| !o.as_reference().is_ok_and(|id| remove.contains(&id))),
            AnnotsLoc::Ref(array) => next
                .get_object_mut(array)
                .and_then(Object::as_array_mut)
                .map_err(ser_err)?
                .retain(|o| !o.as_reference().is_ok_and(|id| remove.contains(&id))),
            AnnotsLoc::Missing => return Err(invalid("missing annotation array")),
        }
        for id in remove {
            next.objects.remove(&id);
        }
        Graph::read(&next, page)?;
        self.journal.record(self.doc.clone());
        self.doc = next;
        Ok(CommandResult::data(json!({"ok":true})))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn apply(e: &mut FolioEngine, op: &str, p: Value) -> Value {
        e.apply(Command::new(op, p)).unwrap().data
    }
    fn fixture() -> (FolioEngine, u64) {
        let mut e = FolioEngine::new();
        apply(&mut e, "new", json!({"pages":2}));
        let id=apply(&mut e,"addAnnotation",json!({"page":0,"rect":[1,2,3,4],"contents":"Root","subtype":"Highlight","author":"Owner","modified":"D:20261107120000Z"}))["annot_id"].as_u64().unwrap();
        (e, id)
    }
    fn threads(e: &mut FolioEngine, author: Option<&str>) -> Value {
        let mut p = json!({"page":0});
        if let Some(a) = author {
            p["review_author"] = json!(a);
        }
        apply(e, "listCommentThreads", p)["threads"].clone()
    }
    fn review(e: &mut FolioEngine, id: u64, author: &str, resolved: bool, date: &str) -> Value {
        apply(
            e,
            "setAnnotationReview",
            json!({"page":0,"id":id,"author":author,"modified":date,"resolved":resolved}),
        )
    }
    #[test]
    fn generic_widget_and_ink_deletion_preserve_imported_pdf_contract() {
        let (mut e, _) = fixture();
        let page = e.page_id(0).unwrap();
        let widget=e.doc.add_object(dictionary!{"Type"=>"Annot","Subtype"=>"Widget","Rect"=>vec![0.into(),0.into(),1.into(),1.into()],"T"=>lopdf::text_string(&"field".repeat(100))});
        push(&mut e.doc, page, widget).unwrap();
        let ink=e.doc.add_object(dictionary!{"Type"=>"Annot","Subtype"=>"Ink","Rect"=>vec![0.into(),0.into(),1.into(),1.into()],"InkList"=>vec![Object::Array(vec![0.into(),0.into(),1.into(),1.into()])]});
        push(&mut e.doc, page, ink).unwrap();
        let saved = apply(&mut e, "save", json!({}));
        let mut loaded = FolioEngine::new();
        apply(&mut loaded, "open", json!({"bytes_b64":saved["bytes_b64"]}));
        for target in [widget, ink] {
            let before = loaded.snapshot().unwrap();
            apply(
                &mut loaded,
                "removeAnnotation",
                json!({"page":0,"id":target.0}),
            );
            assert!(!loaded.doc.objects.contains_key(&target));
            let saved = apply(&mut loaded, "save", json!({}));
            let pdf =
                Document::load_mem(&b64_decode(saved["bytes_b64"].as_str().unwrap()).unwrap())
                    .unwrap();
            assert!(!pdf.objects.contains_key(&target));
            assert!(loaded.undo().unwrap());
            assert_eq!(loaded.snapshot().unwrap(), before);
        }
        loaded
            .doc
            .add_object(dictionary! {"Kids"=>vec![Object::Reference(widget)]});
        let before = loaded.snapshot().unwrap();
        assert!(loaded
            .apply(Command::new(
                "removeAnnotation",
                json!({"page":0,"id":widget.0})
            ))
            .is_err());
        assert_eq!(loaded.snapshot().unwrap(), before);
    }

    #[test]
    fn shared_page_root_without_p_rejects_reply_delete_and_preserves_history() {
        let (mut e, id) = fixture();
        let page1 = e.page_id(1).unwrap();
        e.doc
            .get_object_mut(page1)
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .set("Annots", vec![Object::Reference((id as u32, 0))]);
        let saved = apply(&mut e, "save", json!({}));
        let mut loaded = FolioEngine::new();
        apply(&mut loaded, "open", json!({"bytes_b64":saved["bytes_b64"]}));
        let before = loaded.snapshot().unwrap();
        for (op, p) in [
            (
                "addAnnotationReply",
                json!({"page":0,"id":id,"author":"A","modified":"D:20261107120000Z","contents":"reply"}),
            ),
            ("removeAnnotation", json!({"page":0,"id":id})),
        ] {
            assert!(loaded.apply(Command::new(op, p)).is_err());
            assert_eq!(loaded.snapshot().unwrap(), before);
        }
        assert!(loaded.undo().unwrap());
        assert_eq!(loaded.page_count(), 0);
    }

    #[test]
    fn limits_dangling_depth_and_object_exhaustion_reject_atomically() {
        let (mut e, id) = fixture();
        let page = e.page_id(0).unwrap();
        for _ in 0..256 {
            let reply=e.doc.add_object(dictionary!{"Subtype"=>"Text","IRT"=>Object::Reference((id as u32,0)),"Contents"=>lopdf::text_string("reply")});
            push(&mut e.doc, page, reply).unwrap();
        }
        let before = e.snapshot().unwrap();
        assert!(e
            .apply(Command::new("removeAnnotation", json!({"page":0,"id":id})))
            .is_err());
        assert_eq!(e.snapshot().unwrap(), before);
        let (mut e, id) = fixture();
        let page = e.page_id(0).unwrap();
        let mut parent = (id as u32, 0);
        for _ in 0..65 {
            let reply=e.doc.add_object(dictionary!{"Subtype"=>"Text","IRT"=>Object::Reference(parent),"Contents"=>lopdf::text_string("reply")});
            push(&mut e.doc, page, reply).unwrap();
            parent = reply;
        }
        assert!(e
            .apply(Command::new("listCommentThreads", json!({"page":0})))
            .is_err());
        let (mut e, id) = fixture();
        e.doc
            .get_object_mut((id as u32, 0))
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .set("IRT", Object::Reference((99999, 0)));
        let before = e.snapshot().unwrap();
        assert!(e
            .apply(Command::new("removeAnnotation", json!({"page":0,"id":id})))
            .is_err());
        assert_eq!(e.snapshot().unwrap(), before);
        let (mut e, id) = fixture();
        e.doc.max_id = u32::MAX;
        let before = e.doc.objects.clone();
        assert!(e.apply(Command::new("addAnnotationReply",json!({"page":0,"id":id,"author":"A","modified":"D:20261107120000Z","contents":"reply"}))).is_err());
        assert_eq!(e.doc.objects, before);
        assert_eq!(e.doc.max_id, u32::MAX);
    }

    #[test]
    fn replies_and_author_specific_state_chains_survive_real_pdf_reopen() {
        let (mut e, id) = fixture();
        let before = e.snapshot().unwrap();
        let reply=apply(&mut e,"addAnnotationReply",json!({"page":0,"id":id,"contents":"返信 😀","author":"Reviewer","modified":"D:20261107120100Z"}))["annot_id"].as_u64().unwrap();
        let first = review(&mut e, id, "Reviewer", true, "D:20261107120200Z")["annot_id"]
            .as_u64()
            .unwrap();
        let state = e
            .doc
            .get_object((first as u32, 0))
            .unwrap()
            .as_dict()
            .unwrap();
        assert_eq!(state.get(b"F").unwrap().as_i64().unwrap(), 2);
        assert_eq!(
            state.get(b"IRT").unwrap().as_reference().unwrap(),
            (id as u32, 0)
        );
        assert_eq!(
            lopdf::decode_text_string(state.get(b"State").unwrap()).unwrap(),
            "Completed"
        );
        assert!(matches!(
            state.get(b"StateModel").unwrap(),
            Object::String(..)
        ));
        assert_eq!(threads(&mut e, Some("Reviewer"))[0]["resolved"], true);
        assert_eq!(threads(&mut e, Some("Other"))[0]["resolved"], false);
        assert!(threads(&mut e, None)[0].get("resolved").is_none());
        review(&mut e, id, "Other", true, "D:20261107120200Z");
        let reopened = review(&mut e, id, "Reviewer", false, "D:20261107120300Z")["annot_id"]
            .as_u64()
            .unwrap();
        assert_eq!(
            e.doc
                .get_object((reopened as u32, 0))
                .unwrap()
                .as_dict()
                .unwrap()
                .get(b"IRT")
                .unwrap()
                .as_reference()
                .unwrap(),
            (first as u32, 0)
        );
        let projected = threads(&mut e, Some("Reviewer"));
        assert_eq!(projected[0]["author"], "Owner");
        assert_eq!(projected[0]["modified"], "D:20261107120000Z");
        assert_eq!(projected[0]["resolved"], false);
        assert_eq!(projected[0]["replies"].as_array().unwrap().len(), 1);
        assert_eq!(projected[0]["replies"][0]["contents"], "返信 😀");
        assert_eq!(projected[0]["replies"][0]["id"], reply);
        assert_eq!(threads(&mut e, Some("Other"))[0]["resolved"], true);
        let saved = apply(&mut e, "save", json!({}));
        let mut loaded = FolioEngine::new();
        apply(&mut loaded, "open", json!({"bytes_b64":saved["bytes_b64"]}));
        assert_eq!(threads(&mut loaded, Some("Reviewer")), projected);
        assert!(e.undo().unwrap());
        assert_eq!(threads(&mut e, Some("Reviewer"))[0]["resolved"], true);
        assert!(e.redo().unwrap());
        assert_eq!(threads(&mut e, Some("Reviewer")), projected);
        while e.undo().unwrap() {}
        assert_ne!(e.snapshot().unwrap(), before);
    }
    #[test]
    fn root_and_reply_subtrees_delete_atomically_and_undo_reopen() {
        let (mut e, id) = fixture();
        let reply=apply(&mut e,"addAnnotationReply",json!({"page":0,"id":id,"contents":"reply","author":"A","modified":"D:20261107120000Z"}))["annot_id"].as_u64().unwrap();
        let page = e.page_id(0).unwrap();
        let child=e.doc.add_object(dictionary!{"Subtype"=>"Text","IRT"=>Object::Reference((reply as u32,0)),"Contents"=>lopdf::text_string("nested reply")});
        push(&mut e.doc, page, child).unwrap();
        review(&mut e, id, "A", true, "D:20261107120100Z");
        review(&mut e, id, "A", false, "D:20261107120200Z");
        let before = e.snapshot().unwrap();
        apply(&mut e, "removeAnnotation", json!({"page":0,"id":reply}));
        assert!(threads(&mut e, Some("A"))[0]["replies"]
            .as_array()
            .unwrap()
            .is_empty());
        assert!(e.undo().unwrap());
        assert_eq!(e.snapshot().unwrap(), before);
        apply(&mut e, "removeAnnotation", json!({"page":0,"id":id}));
        assert!(threads(&mut e, Some("A")).as_array().unwrap().is_empty());
        assert!(annot_ids(&e.doc, e.page_id(0).unwrap()).unwrap().is_empty());
        let saved = apply(&mut e, "save", json!({}));
        let mut loaded = FolioEngine::new();
        apply(&mut loaded, "open", json!({"bytes_b64":saved["bytes_b64"]}));
        assert!(threads(&mut loaded, Some("A"))
            .as_array()
            .unwrap()
            .is_empty());
        assert!(e.undo().unwrap());
        assert_eq!(e.snapshot().unwrap(), before);
    }
    #[test]
    fn invalid_metadata_cross_page_cycles_and_incoming_replies_reject_without_history() {
        let (mut e, id) = fixture();
        review(&mut e, id, "A", true, "D:20261107120100Z");
        e.undo().unwrap();
        let before = e.snapshot().unwrap();
        for p in [
            json!({"page":1,"id":id,"contents":"reply","author":"A","modified":"D:20261107120000Z"}),
            json!({"page":0,"id":id,"contents":"reply","author":"","modified":"D:20261107120000Z"}),
            json!({"page":0,"id":id,"contents":"reply","author":"A","modified":"D:20260230120000Z"}),
            json!({"page":0,"id":id,"contents":"x".repeat(32768),"author":"A","modified":"D:20261107120000Z"}),
        ] {
            assert!(e.apply(Command::new("addAnnotationReply", p)).is_err());
            assert_eq!(e.snapshot().unwrap(), before);
        }
        assert!(e.redo().unwrap());
        let mut cycle = FolioEngine::new();
        cycle.restore(&before).unwrap();
        cycle
            .doc
            .get_object_mut((id as u32, 0))
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .set("IRT", Object::Reference((id as u32, 0)));
        let corrupt = cycle.snapshot().unwrap();
        assert!(cycle
            .apply(Command::new("removeAnnotation", json!({"page":0,"id":id})))
            .is_err());
        assert_eq!(cycle.snapshot().unwrap(), corrupt);
        let cross = apply(
            &mut e,
            "addAnnotation",
            json!({"page":1,"rect":[0,0,1,1],"contents":"foreign","subtype":"Text"}),
        )["annot_id"]
            .as_u64()
            .unwrap();
        e.doc
            .get_object_mut((cross as u32, 0))
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .set("IRT", Object::Reference((id as u32, 0)));
        let corrupt = e.snapshot().unwrap();
        assert!(e
            .apply(Command::new("removeAnnotation", json!({"page":0,"id":id})))
            .is_err());
        assert_eq!(e.snapshot().unwrap(), corrupt);
    }
    #[test]
    fn noops_monotonic_review_dates_and_conservative_import_states() {
        let (mut e, id) = fixture();
        let state = review(&mut e, id, "A", true, "D:20261107120100Z")["annot_id"]
            .as_u64()
            .unwrap();
        let before = e.snapshot().unwrap();
        let noop=e.apply(Command::new("setAnnotationReview",json!({"page":0,"id":id,"author":"A","modified":"D:20261107120100Z","resolved":true}))).unwrap();
        assert!(noop.events.is_empty());
        assert_eq!(e.snapshot().unwrap(), before);
        assert!(e.apply(Command::new("setAnnotationReview",json!({"page":0,"id":id,"author":"A","modified":"D:20261107120000Z","resolved":false}))).is_err());
        assert_eq!(e.snapshot().unwrap(), before);
        e.doc
            .get_object_mut((state as u32, 0))
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .set("State", lopdf::text_string("Accepted"));
        let projected = threads(&mut e, Some("A"));
        assert_eq!(projected[0]["review_state"], "Accepted");
        assert!(projected[0].get("resolved").is_none());
    }
}
