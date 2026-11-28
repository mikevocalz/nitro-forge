import {AppRegistry,ScrollView,Text,View,useWindowDimensions} from "react-native";
import {create} from "zustand";
import {SlideFilmstrip} from "../../../src/slides/SlideFilmstrip.tsx";
import {SlideSorter} from "../../../src/slides/SlideSorter.tsx";
import {SlideCanvas} from "../../../src/slides/SlideCanvas.tsx";
import {SlideAnimationPane} from "../../../src/slides/SlideAnimationPane.tsx";
import {SLIDE_ANIMATION_EFFECTS,type SlideAnimation} from "../../../src/slides/animation-model.ts";
import {moveId,type SlideObject,type SlideSummary} from "../../../src/slides/slide-model.ts";
import {RichTextRibbon} from "../../../src/document/RichTextRibbon.tsx";
import {ribbonStateFor,type RunStyle} from "../../../src/document/ribbon-model.ts";
import {BulletsNumberingEditor} from "../../../src/document/BulletsNumberingEditor.tsx";
import {defaultLevelFormats,shiftLevels,type ListFormat,type ListKind} from "../../../src/document/list-model.ts";
import {NavigationOutline} from "../../../src/document/NavigationOutline.tsx";
import type {OutlineHeading} from "../../../src/document/outline-model.ts";
import {DocumentReadAloudTransport} from "../../../src/document/DocumentReadAloudTransport.tsx";
import {readAloudSentences} from "../../../src/office/read-aloud-model.ts";
import {TextSearchResults} from "../../../src/pdf/TextSearchResults.tsx";
import {findInPageText,insertPageHits,searchPageOrder,type PdfSearchHit} from "../../../src/pdf/search-model.ts";
import {AnnotationToolbar} from "../../../src/pdf/AnnotationToolbar.tsx";
import type {AnnotationTool} from "../../../src/pdf/annotation-model.ts";
import {CommentsThreadPanel} from "../../../src/pdf/CommentsThreadPanel.tsx";
import type {CommentFilter,CommentThread} from "../../../src/pdf/comments-model.ts";
import {PDFReadAloudTransport} from "../../../src/pdf/PDFReadAloudTransport.tsx";
import type {ReadAloudStatus} from "../../../src/office/ReadAloudTransport.tsx";

const params=new URLSearchParams(location.search);
const part=params.get("part")??"slides";

// Deck content: fills and text colors are document data, as the Pitch engine stores them.
const text=(id:string,x:number,y:number,w:number,h:number,t:string,fontSize:number,bold=false):SlideObject=>
  ({id,kind:"text",x,y,w,h,rotation:0,text:t,fontSize,bold,color:[24,32,48,255]});
const rect=(id:string,x:number,y:number,w:number,h:number,fill:[number,number,number,number]):SlideObject=>({id,kind:"rect",x,y,w,h,rotation:0,fill});
const deck:SlideSummary[]=[
  {id:"1",background:[246,244,238,255],objects:[text("t1",80,170,800,90,"Harbor Line expansion",56,true),text("s1",80,280,700,50,"Board review, November",28),rect("r1",80,350,160,8,[200,74,40,255])]},
  {id:"2",background:[255,255,255,255],objects:[text("t2",60,40,840,60,"Ridership since launch",40,true),rect("b1",80,380,90,100,[40,90,160,255]),rect("b2",200,320,90,160,[40,90,160,255]),rect("b3",320,240,90,240,[40,90,160,255]),rect("b4",440,170,90,310,[200,74,40,255])]},
  {id:"3",background:[24,32,48,255],objects:[{...text("t3",80,200,800,120,"Three stations open in 2027",48,true),color:[246,244,238,255]}]},
  {id:"4",background:[255,255,255,255],objects:[text("t4",60,40,840,60,"Budget",40,true),{id:"i4",kind:"image",x:520,y:140,w:360,h:300,rotation:0,src:"map.png"},text("p4",60,140,420,300,"Capital: 412M\nOperations: 38M per year\nContingency: 9%",26)]},
  {id:"5",background:[246,244,238,255],objects:[]},
];
type Slides={slides:SlideSummary[];selected:string;object:string|undefined;sorterSel:string[];animations:Record<string,SlideAnimation[]>;moves:number};
const useSlides=create<Slides>(()=>({slides:deck,selected:"2",object:"b4",sorterSel:["2"],moves:0,
  animations:{"2":[{index:0,objectId:"t2",kind:"fadeIn",startS:0,durationS:0.5},{index:1,objectId:"b4",kind:"zoomIn",startS:0.6,durationS:0.8}]}}));
const patchObject=(id:string,f:(o:SlideObject)=>SlideObject)=>useSlides.setState(s=>({moves:s.moves+1,
  slides:s.slides.map(sl=>sl.id!==s.selected?sl:{...sl,objects:sl.objects.map(o=>o.id===id?f(o):o)})}));

function SlidesPart({wide}:{wide:boolean}){
  const s=useSlides();
  const slide=s.slides.find(x=>x.id===s.selected)!;
  const anims=s.animations[s.selected]??[];
  const label=(id:string)=>{const o=slide.objects.find(x=>x.id===id);return o?.kind==="text"?(o.text??"").split("\n")[0]!:o?.kind==="rect"?"Bar "+id:"Image";};
  const canvas=<SlideCanvas testID="canvas" slide={slide} selectedObjectId={s.object} onSelectObject={id=>useSlides.setState({object:id})}
    onMoveObject={(id,x,y)=>patchObject(id,o=>({...o,x,y}))} onResizeObject={(id,w,h)=>patchObject(id,o=>({...o,w,h}))}
    onRotateObject={(id,d)=>patchObject(id,o=>({...o,rotation:d}))} onSetText={(id,t)=>patchObject(id,o=>({...o,text:t}))}
    onRemoveObject={id=>useSlides.setState(st=>({object:undefined,slides:st.slides.map(sl=>sl.id!==st.selected?sl:{...sl,objects:sl.objects.filter(o=>o.id!==id)})}))}
    style={{flex:1,minHeight:wide?420:220}}/>;
  return <View style={{gap:16}}>
    <View style={{flexDirection:wide?"row":"column",gap:12}}>
      <SlideFilmstrip testID="filmstrip" slides={s.slides} selectedId={s.selected} thumbnailWidth={wide?136:96} orientation={wide?"vertical":"horizontal"}
        onSelect={id=>useSlides.setState({selected:id,object:undefined})}
        onMove={(id,to)=>useSlides.setState(st=>{const order=moveId(st.slides.map(x=>x.id),id,to);return {slides:order.map(i=>st.slides.find(x=>x.id===i)!)};})}
        onAdd={()=>useSlides.setState(st=>{const id=String(Math.max(...st.slides.map(x=>Number(x.id)))+1);return {slides:[...st.slides,{id,objects:[]}],selected:id};})}
        onRemove={id=>useSlides.setState(st=>({slides:st.slides.filter(x=>x.id!==id),selected:st.selected===id?st.slides.find(x=>x.id!==id)!.id:st.selected}))}
        style={{width:wide?176:undefined,maxHeight:wide?560:undefined}}/>
      {canvas}
    </View>
    <View style={{flexDirection:wide?"row":"column",gap:16,alignItems:"flex-start"}}>
      <SlideAnimationPane testID="animations" animations={anims} effects={[SLIDE_ANIMATION_EFFECTS.fadeIn,SLIDE_ANIMATION_EFFECTS.slideInLeft,SLIDE_ANIMATION_EFFECTS.zoomIn]}
        objectLabel={label} selectedObjectId={s.object}
        onAdd={a=>{if(a.durationS>10)return Promise.reject(new Error("The engine refused: duration_s must be 10 s or less in this demo."));
          useSlides.setState(st=>({animations:{...st.animations,[st.selected]:[...anims,{index:anims.length,...a}]}}));}}
        onRemove={i=>useSlides.setState(st=>({animations:{...st.animations,[st.selected]:anims.filter(x=>x.index!==i).map((x,k)=>({...x,index:k}))}}))}
        style={{flex:1,width:wide?undefined:"100%"}}/>
      <SlideSorter testID="sorter" slides={s.slides} selectedIds={s.sorterSel} onSelectionChange={ids=>useSlides.setState({sorterSel:ids})}
        onOpen={id=>useSlides.setState({selected:id})} minThumbnailWidth={wide?140:150}
        onReorder={order=>useSlides.setState(st=>({slides:order.map(i=>st.slides.find(x=>x.id===i)!)}))}
        onRemove={ids=>useSlides.setState(st=>({slides:st.slides.filter(x=>!ids.includes(x.id)),sorterSel:[]}))} style={{flex:wide?1.4:undefined,width:wide?undefined:"100%"}}/>
    </View>
    <Text testID="slides-state" {...{className:"text-text-muted"}}>{"order "+s.slides.map(x=>x.id).join(",")+" moves "+s.moves+" object "+(s.object??"none")+" "+
      (slide.objects.find(o=>o.id===s.object)?(()=>{const o=slide.objects.find(x=>x.id===s.object)!;return `${o.x},${o.y},${o.w},${o.h},${o.rotation}`;})():"")}</Text>
</View>;
}

const paragraphs=[
  {kind:"h1",text:"Harbor Line expansion"},{kind:"para",text:"The board approved three new stations. Dr. Okafor presented the plan on Monday."},
  {kind:"h2",text:"Scope"},{kind:"para",text:"Construction starts in March. Each station has step-free access."},
  {kind:"h3",text:"Stations"},{kind:"list",text:"Pier Street",level:0},{kind:"list",text:"North platform",level:1},{kind:"list",text:"Customs House",level:0},{kind:"list",text:"Ferry deck",level:0},
  {kind:"h2",text:"Budget"},{kind:"para",text:"Capital cost is 412M. Operations add 38M a year!"},
];
type Doc={runs:RunStyle[];kind:ListKind|"mixed";levels:number[];formats:ListFormat[];caret:number;status:ReadAloudStatus;index:number;word:number|undefined;rate:number;color:string|undefined;size:number;style:string};
const useDoc=create<Doc>(()=>({runs:[{bold:true},{bold:false,italic:true}],kind:"multilevel",levels:[0,1,0,0],formats:defaultLevelFormats("multilevel"),
  caret:3,status:"paused",index:2,word:3,rate:1.25,color:undefined,size:12,style:"para"}));
const docSentences=readAloudSentences(paragraphs.map((p,block)=>({block,text:p.text})));
const headings:OutlineHeading[]=paragraphs.flatMap((p,block)=>p.kind.startsWith("h")?[{id:"h"+block,level:Number(p.kind[1]),text:p.text,block,page:block<5?0:1}]:[]);

function DocumentPart({wide}:{wide:boolean}){
  const d=useDoc();
  const listItems=paragraphs.filter(p=>p.kind==="list").map((p,i)=>({id:"l"+i,text:p.text,level:d.levels[i]??0}));
  return <View style={{gap:16}}>
    <RichTextRibbon testID="ribbon" state={{...ribbonStateFor(d.runs),color:d.color}}
      onToggle={(t,on)=>useDoc.setState(s=>({runs:s.runs.map(r=>({...r,[t]:on}))}))}
      colors={[{value:"#1f2a44",label:"Navy"},{value:"#b3261e",label:"Red"},{value:"#1f7a3c",label:"Green"}]} onColorChange={c=>useDoc.setState({color:c})}
      fontSize={d.size} onFontSizeChange={size=>useDoc.setState({size})}
      paragraphStyles={[{id:"para",label:"Normal"},{id:"h1",label:"Heading 1"},{id:"h2",label:"Heading 2"},{id:"quote",label:"Quote"}]}
      paragraphStyle={d.style} onParagraphStyleChange={style=>useDoc.setState({style})}/>
    <View style={{flexDirection:wide?"row":"column",gap:16,alignItems:"flex-start"}}>
      <NavigationOutline testID="outline" headings={headings} caretBlock={d.caret} onJumpToHeading={h=>useDoc.setState({caret:h.block})}
        pageCount={2} onJumpToPage={p=>useDoc.setState({caret:p===0?0:5})} style={{width:wide?300:"100%"}}/>
      <View style={{flex:1,gap:16,width:wide?undefined:"100%"}}>
        <BulletsNumberingEditor testID="lists" items={listItems} selectionStart={1} selectionEnd={1} kind={d.kind}
          kinds={["none","bullet","numbered","multilevel"]} onKindChange={k=>useDoc.setState({kind:k,formats:k==="none"?d.formats:defaultLevelFormats(k)})}
          levelFormats={d.formats} onLevelFormatChange={(l,f)=>useDoc.setState(s=>({formats:s.formats.map((x,i)=>i===l?f:x)}))}
          onShiftLevel={dir=>useDoc.setState(s=>({levels:shiftLevels(s.levels.map(level=>({level})),1,1,dir).map(x=>x.level)}))}/>
        <DocumentReadAloudTransport testID="doc-read" sentences={docSentences} index={d.index} wordIndex={d.word} status={d.status} rate={d.rate}
          describeBlock={b=>{let h:OutlineHeading|undefined;for(const x of headings)if(x.block<=b)h=x;return h?.text;}}
          onRateChange={rate=>useDoc.setState({rate})} onPlay={()=>useDoc.setState({status:"playing"})} onPause={()=>useDoc.setState({status:"paused"})}
          onSkip={dir=>useDoc.setState(s=>({index:s.index+dir,word:0}))} onStop={()=>useDoc.setState({status:"stopped",word:undefined})}/>
      </View>
    </View>
    <Text testID="doc-state" {...{className:"text-text-muted"}}>{`runs ${JSON.stringify(d.runs)} kind ${d.kind} levels ${d.levels.join(",")} caret ${d.caret} status ${d.status} index ${d.index} rate ${d.rate} size ${d.size} color ${d.color??"auto"}`}</Text>
  </View>;
}

const pages=[
  "Harbor Line expansion. Board review packet. The harbor line adds three stations.",
  "Ridership grew 14% since launch. Weekend ridership on the harbor line doubled.",
  "Budget summary. Capital cost is 412M. The Harbor Authority funds 60%.",
  "Appendix: station list. Pier Street, Customs House, Ferry deck. HARBOR access ramps.",
];
type Pdf={query:string;searched:string|undefined;hits:PdfSearchHit[];current:number;scanned:number;running:boolean;caseSensitive:boolean;whole:boolean;
  tool:AnnotationTool;threads:CommentThread[];selected:string|undefined;filter:CommentFilter;status:ReadAloudStatus;index:number;rate:number;fail:boolean};
const usePdf=create<Pdf>(()=>({query:"harbor",searched:undefined,hits:[],current:-1,scanned:0,running:false,caseSensitive:false,whole:false,tool:"highlight",
  selected:"c2",filter:"open",status:"stopped",index:0,rate:1,fail:params.get("fail")==="1",
  threads:[
    {id:"c1",page:0,body:"Use the board's wording for the title.",author:"Rana Iyer",timeLabel:"Yesterday",replies:[{id:"r1",body:"Changed in v3.",author:"Sam Ortiz",timeLabel:"Today"}],resolved:false},
    {id:"c2",page:2,body:"Where does the 60% figure come from?",author:"Sam Ortiz",timeLabel:"2 hours ago",replies:[],resolved:false},
    {id:"c3",page:3,body:"",replies:[],resolved:true},
  ]}));
const pdfSentences=readAloudSentences(pages.map((text,block)=>({block,text})));
function runSearch(q:string){
  const s=usePdf.getState();
  let acc={hits:[] as PdfSearchHit[],current:-1};
  usePdf.setState({searched:q,running:true,hits:[],current:-1,scanned:0});
  for(const page of searchPageOrder(pages.length,1)){
    const found=findInPageText(page,pages[page]!,q,{caseSensitive:s.caseSensitive,wholeWords:s.whole});
    const r=insertPageHits(acc.hits,found,acc.current);
    acc={hits:r.hits,current:r.current};
  }
  usePdf.setState({hits:acc.hits,current:acc.current,scanned:pages.length,running:false});
}

function PdfPart({wide}:{wide:boolean}){
  const p=usePdf();
  return <View style={{gap:16}}>
    <AnnotationToolbar testID="annotate" tools={["select","note","highlight"]} activeTool={p.tool} onToolChange={tool=>usePdf.setState({tool})}
      onUndo={()=>{}} canUndo={false} onRedo={()=>{}} canRedo={false}
      hint={p.tool==="highlight"?"Drag across text on the page to highlight it.":p.tool==="note"?"Tap the page where the note goes.":undefined}/>
    <View style={{flexDirection:wide?"row":"column",gap:16,alignItems:"flex-start"}}>
      <TextSearchResults testID="search" query={p.query} onQueryChange={query=>usePdf.setState({query})} onSubmit={runSearch} searchedQuery={p.searched}
        hits={p.hits} current={p.current} onSelect={i=>usePdf.setState({current:i})}
        progress={{searched:p.scanned,pageCount:pages.length,running:p.running}}
        caseSensitive={p.caseSensitive} onCaseSensitiveChange={v=>usePdf.setState({caseSensitive:v})}
        wholeWords={p.whole} onWholeWordsChange={v=>usePdf.setState({whole:v})} style={{width:wide?380:"100%",maxHeight:520}}/>
      <CommentsThreadPanel testID="comments" threads={p.threads} selectedId={p.selected} onSelect={id=>usePdf.setState({selected:id})}
        filter={p.filter} onFilterChange={filter=>usePdf.setState({filter})}
        onReply={(id,body)=>usePdf.getState().fail?Promise.reject(new Error("Couldn't save the reply. Check the connection and send it again.")):
          usePdf.setState(s=>({threads:s.threads.map(t=>t.id===id?{...t,replies:[...t.replies,{id:id+"-"+t.replies.length,body,author:"You",timeLabel:"Just now"}]}:t)}))}
        onResolvedChange={(id,resolved)=>usePdf.setState(s=>({threads:s.threads.map(t=>t.id===id?{...t,resolved}:t)}))}
        onDelete={id=>usePdf.setState(s=>({threads:s.threads.filter(t=>t.id!==id)}))} style={{flex:1,width:wide?undefined:"100%"}}/>
    </View>
    <PDFReadAloudTransport testID="pdf-read" sentences={pdfSentences} index={p.index} status={params.get("novoice")==="1"?"unavailable":p.status} rate={p.rate}
      pageCount={pages.length} onJumpToPage={page=>usePdf.setState({index:pdfSentences.findIndex(x=>x.block===page)})}
      onRateChange={rate=>usePdf.setState({rate})} onPlay={()=>usePdf.setState({status:"playing"})} onPause={()=>usePdf.setState({status:"paused"})}
      onSkip={dir=>usePdf.setState(s=>({index:s.index+dir}))}/>
    <Text testID="pdf-state" {...{className:"text-text-muted"}}>{`tool ${p.tool} current ${p.current} hits ${p.hits.length} filter ${p.filter} threads ${p.threads.map(t=>t.id+":"+t.replies.length+(t.resolved?"r":"")).join(",")} index ${p.index} status ${p.status}`}</Text>
  </View>;
}

function Fixture(){
  const {width}=useWindowDimensions();
  const wide=width>=700;
  return <ScrollView style={{flex:1}} contentContainerStyle={{padding:16,gap:16}} {...{className:"bg-surface-sunken"}}>
    {part==="slides"?<SlidesPart wide={wide}/>:part==="document"?<DocumentPart wide={wide}/>:<PdfPart wide={wide}/>}
  </ScrollView>;
}
document.documentElement.dataset.theme=params.get("theme")??"light";
if(params.get("dir")==="rtl")document.documentElement.dir="rtl";
AppRegistry.registerComponent("OfficeAcceptance",()=>Fixture);
AppRegistry.runApplication("OfficeAcceptance",{rootTag:document.getElementById("root")});
