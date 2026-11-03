import { ScrollView, Text, View } from 'react-native';
import type { Studio } from '@nitro-forge/studio-layout';

type Data = Record<string, any>;
const record = (value: unknown): Data => value && typeof value === 'object' ? value as Data : {};
const array = (value: unknown): Data[] => Array.isArray(value) ? value : [];
const rgba = (value: unknown, fallback = '#d9b47a') => Array.isArray(value) && value.length >= 3
  ? `rgba(${value[0]},${value[1]},${value[2]},${(value[3] ?? 255) / 255})` : fallback;


/** Read-only projections of the real engine state. Hosts can replace this slot
 * with their native canvas without replacing the workspace or document session. */
export function ForgeDocumentStage({ studioId, state, theme = 'dark' }: { studioId: Studio; state: unknown; theme?: 'dark' | 'light' }) {
  const caption = { color: theme === 'light' ? '#556359' : '#99a19d', fontSize: 11, lineHeight: 18 } as const;
  const doc = record(state);
  if (!state) return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}><Text style={caption}>Opening document…</Text></View>;
  const heading = (title: string, detail: string) => <View style={{ gap: 4, marginBottom: 20 }}><Text style={{ color: theme === 'light' ? '#202923' : '#eef0e9', fontSize: 22, fontWeight: '500' }}>{title}</Text><Text style={caption}>{detail}</Text></View>;
  const paper = (children: React.ReactNode) => <View style={{ backgroundColor: '#f7f5ed', minHeight: 360, padding: 28, width: '100%', maxWidth: 680, alignSelf: 'center', borderRadius: 2 }}>{children}</View>;
  let content: React.ReactNode;
  if (studioId === 'quill') {
    content = <>{heading('The written page', 'Live text and paragraph styles from Quill')}{paper(array(doc.blocks).map((block, i) => <Text key={i} selectable style={{ color: '#283329', fontSize: block.kind === 'h1' ? 28 : block.kind === 'h2' ? 22 : 15, lineHeight: block.kind === 'h1' ? 38 : 25, marginBottom: 14, fontWeight: block.kind?.startsWith('h') ? '700' : '400', borderLeftWidth: block.kind === 'quote' ? 3 : 0, borderLeftColor: '#ad8551', paddingLeft: block.kind === 'quote' ? 12 : 0 }}>
      {array(block.inlines).map((inline, j) => <Text key={j} style={{ fontWeight: inline.style?.bold ? '700' : undefined, fontStyle: inline.style?.italic ? 'italic' : 'normal', textDecorationLine: inline.style?.underline ? 'underline' : inline.style?.strike ? 'line-through' : 'none', color: inline.style?.color ?? '#283329' }}>{inline.text}</Text>)}
      {!array(block.inlines).some(i => i.text) ? 'Add content using Commands.' : ''}
    </Text>))}</>;
  } else if (studioId === 'tally') {
    const sheet = array(doc.sheets)[doc.active ?? 0];
    const cells = record(sheet?.cells);
    content = <>{heading(sheet?.name ?? 'Workbook', 'Raw values and formulas · select Commands to edit')}
      <ScrollView horizontal><View style={{ backgroundColor: '#f7f5ed', borderRadius: 3 }}>
        <View style={{ flexDirection: 'row' }}>{['', 'A', 'B', 'C', 'D', 'E'].map((v, i) => <Text key={i} style={{ width: i === 0 ? 40 : 104, padding: 12, color: '#637161', backgroundColor: '#e5e9dd', fontSize: 12, textAlign: 'center' }}>{v}</Text>)}</View>
        {Array.from({ length: 12 }, (_, row) => <View key={row} style={{ flexDirection: 'row' }}><Text style={{ width: 40, padding: 12, color: '#637161', backgroundColor: '#e5e9dd', textAlign: 'center', fontSize: 12 }}>{row + 1}</Text>{['A', 'B', 'C', 'D', 'E'].map(col => <Text key={col} selectable numberOfLines={1} style={{ width: 104, minHeight: 40, borderTopWidth: 1, borderRightWidth: 1, borderColor: '#dce0d5', padding: 10, color: '#263b2b', fontSize: 12 }}>{cells[`${col}${row + 1}`]?.raw ?? ''}</Text>)}</View>)}
      </View></ScrollView></>;
  } else if (studioId === 'pitch') {
    content = <>{heading(doc.meta?.title ?? 'Untitled deck', `${array(doc.slides).length} slides · live object geometry`)}
      {array(doc.slides).map((slide, i) => <View key={slide.id} style={{ marginBottom: 24 }}><Text style={[caption, { marginBottom: 8 }]}>SLIDE {i + 1}</Text>
        <View style={{ width: '100%', aspectRatio: 16 / 9, backgroundColor: rgba(slide.background, '#f7f5ed'), overflow: 'hidden' }}>
          {array(slide.objects).map(object => <View key={object.id} style={{ position: 'absolute', left: `${object.x / 9.6}%`, top: `${object.y / 5.4}%`, width: `${object.w / 9.6}%`, height: `${object.h / 5.4}%`, transform: [{ rotate: `${object.rotation_deg ?? 0}deg` }], backgroundColor: object.kind === 'rect' ? rgba(object.fill) : 'transparent' }}>
            {object.kind === 'text' ? <Text selectable style={{ color: rgba(object.text?.color, '#26372e'), fontSize: Math.min(object.text?.font_size ?? 24, 32), fontWeight: object.text?.bold ? '700' : '400' }}>{object.text?.content}</Text> : object.kind === 'image' ? <Text style={{ color: '#26372e', fontSize: 11 }}>Image: {object.src}</Text> : null}
          </View>)}
          {!array(slide.objects).length && <Text style={{ color: '#798373', margin: 24, fontSize: 12 }}>Blank slide · add an object in Commands</Text>}
        </View>
      </View>)}</>;
  } else if (studioId === 'prism') {
    content = <>{heading('Artboard', `${doc.width} × ${doc.height} px · ${array(doc.layers).length} layers`)}
      <View style={{ alignSelf: 'center', width: '100%', maxWidth: 520, aspectRatio: (doc.width || 1) / (doc.height || 1), backgroundColor: '#f7f5ed', overflow: 'hidden' }}>
        {array(doc.layers).filter(layer => layer.visible).map(layer => {
          const shape = layer.content?.shape;
          return shape ? <View key={layer.id} style={{ position: 'absolute', left: `${shape.x / doc.width * 100}%`, top: `${shape.y / doc.height * 100}%`, width: `${shape.w / doc.width * 100}%`, height: `${shape.h / doc.height * 100}%`, borderRadius: shape.kind === 'ellipse' ? 9999 : 0, backgroundColor: rgba(shape.fill), opacity: layer.opacity }} /> : null;
        })}
      </View>
      <Text style={[caption, { marginTop: 14 }]}>Shape projection. Raster compositing is supplied by the host canvas adapter.</Text>
    </>;
  } else if (studioId === 'cadence' || studioId === 'splice') {
    const audio = studioId === 'cadence';
    const tracks = array(doc.tracks);
    const clips = tracks.flatMap(t => array(t.clips));
    const end = Math.max(audio ? 3840 : 10, ...clips.map(c => audio ? c.start_ticks + c.length_ticks : c.timeline_start_s + (c.out_s - c.in_s) / c.speed));
    content = <>{heading(audio ? 'Arrangement' : 'Timeline', audio ? `${doc.tempo_bpm} BPM · ${doc.time_sig?.join('/')} · ${tracks.length} tracks` : `${doc.fps} FPS · ${tracks.length} tracks`)}
      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>{Array.from({ length: 5 }, (_, i) => <Text key={i} style={caption}>{Math.round(end * i / 4)}{audio ? ' ticks' : 's'}</Text>)}</View>
        {tracks.map(track => <View key={track.id} style={{ backgroundColor: '#222829', borderWidth: 1, borderColor: '#39423f', minHeight: 96, paddingTop: 28, position: 'relative', overflow: 'hidden' }}>
          <Text style={{ position: 'absolute', top: 8, left: 10, color: '#b9c7ba', fontSize: 11 }}>{track.name ?? `${track.kind} ${track.id}`}{track.muted ? ' · muted' : ''}</Text>
          {array(track.clips).map(clip => <View key={clip.id} style={{ position: 'absolute', top: 32, bottom: 8, left: `${(audio ? clip.start_ticks : clip.timeline_start_s) / end * 100}%`, width: `${(audio ? clip.length_ticks : (clip.out_s - clip.in_s) / clip.speed) / end * 100}%`, backgroundColor: audio ? '#637660' : '#725d7c', borderRadius: 4, padding: 7 }}><Text numberOfLines={1} style={{ color: '#ffffff', fontSize: 10 }}>Clip {clip.id}{audio ? ` · ${array(clip.notes).length} notes` : ''}</Text></View>)}
        </View>)}
        {!tracks.length && <Text style={[caption, { paddingVertical: 48 }]}>No tracks yet. Add a track in Commands.</Text>}
      </View>
    </>;
  } else {
    content = <>{heading('PDF overview', `${doc.pages ?? 0} pages · semantic document projection`)}
      {array(doc.page_details).map((page, i) => <View key={i} style={{ marginBottom: 18 }}>{paper(<><Text style={{ fontSize: 28, color: '#354638', marginBottom: 12 }}>{String(i + 1).padStart(2, '0')}</Text><Text style={{ color: '#66735f', fontSize: 13 }}>Rotation {page.rotate ?? 0}°</Text><Text style={{ color: '#66735f', fontSize: 13, marginTop: 8 }}>{`${array(page.annots).length} annotations · page metadata`}</Text></>)}</View>)}
      <Text style={caption}>PDF painting is supplied by the host renderer. This view reflects page metadata.</Text>
    </>;
  }
  return <ScrollView testID={`stage-${studioId}`} style={{ flex: 1 }} contentContainerStyle={{ padding: 24, paddingTop: 12, paddingBottom: 40 }}>{content}</ScrollView>;
}
