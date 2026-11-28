import {useRef} from 'react';
import {View,Text,type ViewProps} from 'react-native';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {Select} from '@nyc-tron/ui/components/Select';
import {ChartBuilder,type ChartBuilderProps} from '../spreadsheet/ChartBuilder.tsx';
import {VirtualSpreadsheetGrid,type VirtualSpreadsheetGridProps} from '../spreadsheet/VirtualSpreadsheetGrid.tsx';
import {TableLayoutInspector,type TableLayoutInspectorProps} from '../document/TableLayoutInspector.tsx';
import { tokens } from '../tokens.ts';
export interface ChartAndTableEditorProps extends Omit<ViewProps,'children'> {
 chart?:ChartBuilderProps;table?:{grid:VirtualSpreadsheetGridProps;layout:TableLayoutInspectorProps};unstyled?:boolean;
}
/** One owner for data, chart series/formatting and table cell layout across office documents. */
export function ChartAndTableEditor({chart,table,unstyled=false,style,...props}:ChartAndTableEditorProps){
 const local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore();const store=local.current,choice=useStore(store,s=>s.mode),mode=choice==='chart'&&!chart?'table':choice==='table'&&!table?'chart':choice;
 return <View {...props} style={[{gap:tokens.spacing.fixedInset,minWidth:0},style]} accessibilityLabel="Slide chart and table editor">{chart&&table?<Select label="Chart or table" value={mode} options={[{value:'chart',label:'Chart'},{value:'table',label:'Table'}]} unstyled={unstyled} onValueChange={mode=>store.setState({mode:mode as 'chart'|'table'})}/>:null}{mode==='chart'&&chart?<ChartBuilder {...chart} unstyled={unstyled}/>:mode==='table'&&table?<><VirtualSpreadsheetGrid {...table.grid} height={table.grid.height??tokens.spacing.off360} unstyled={unstyled}/><TableLayoutInspector {...table.layout} unstyled={unstyled}/></>:<Text {...{className:unstyled?undefined:'text-text'}}>Select a data-bound chart or table</Text>}</View>;
}
function makeStore(){return createStore(()=>({mode:'chart' as 'chart'|'table'}));}
