// Spreadsheet cluster acceptance page: SpreadsheetGrid (I-01, I-02, I-06),
// SheetTabs (I-08), ChartBuilder (I-13), SparklineEditor (I-14),
// FreezeSplitControls + SplitSpreadsheetView (I-17), SpreadsheetCardsView (I-20).
// The workbook below is a test stand-in; in Forge the Tally engine owns it.
import {AppRegistry,ScrollView,Text,View} from "react-native";
import {sparklineValues} from "../../../src/spreadsheet/SparklineEditor.tsx";
import {parseA1Range} from "../../../src/spreadsheet/chart-model.ts";
import {sparklineSpecProblem} from "../../../src/spreadsheet/sparkline-model.ts";
import {create} from "zustand";
import {SpreadsheetGrid,type SpreadsheetCell} from "../../../src/SpreadsheetGrid.tsx";
import {cellAddress,type SheetSelection} from "../../../src/sheet-window.ts";
import {SheetTabs} from "../../../src/spreadsheet/SheetTabs.tsx";
import {nextSheetName,duplicateSheetName,type SheetTab,type SheetTabTone} from "../../../src/spreadsheet/sheet-tabs-model.ts";
import {ChartBuilder} from "../../../src/spreadsheet/ChartBuilder.tsx";
import type {SheetChartSpec} from "../../../src/spreadsheet/chart-model.ts";
import {SparklineEditor} from "../../../src/spreadsheet/SparklineEditor.tsx";
import {Sparkline} from "../../../src/spreadsheet/Sparkline.tsx";
import type {SparklineSpec} from "../../../src/spreadsheet/sparkline-model.ts";
import {FreezeSplitControls} from "../../../src/spreadsheet/FreezeSplitControls.tsx";
import {SplitSpreadsheetView} from "../../../src/spreadsheet/SplitSpreadsheetView.tsx";
import type {FreezeState,SplitState} from "../../../src/spreadsheet/freeze-split-model.ts";
import {SpreadsheetCardsView} from "../../../src/spreadsheet/SpreadsheetCardsView.tsx";
import {FormulaReferenceText} from "../../../src/spreadsheet/FormulaReferenceText.tsx";
import type {FillPlan} from "../../../src/spreadsheet/fill-handle.ts";

const params=new URLSearchParams(location.search);
const theme=params.get("theme")??"light";
const dir=params.get("dir")==="rtl"?"rtl":"ltr";

const rows:[string,number,number][]=[
  ["Jan",120,80],["Feb",135,82],["Mar",128,90],["Apr",160,95],["May",171,99],["Jun",158,104],["Jul",190,110],
];
function seed():Record<string,SpreadsheetCell>{
  const out:Record<string,SpreadsheetCell>={};
  const put=(addr:string,raw:string,computed:SpreadsheetCell["computed"])=>{out[addr]={addr,raw,computed};};
  put("A1","Month","Month");put("B1","Sales","Sales");put("C1","Costs","Costs");put("D1","Margin","Margin");
  rows.forEach(([m,s,c],i)=>{
    const r=i+2;
    put("A"+r,m,m);put("B"+r,String(s),s);put("C"+r,String(c),c);put("D"+r,`=B${r}-C${r}`,s-c);
  });
  put("F2","=SUM(B2:B8)/COUNT(C2:C8)",rows.reduce((n,[,s])=>n+s,0)/rows.length);
  return out;
}

type Demo={
  cells:Record<string,SpreadsheetCell>;selection:SheetSelection;fills:number;
  tabs:SheetTab[];active:string;freeze:FreezeState;split:SplitState|undefined;
  chart:SheetChartSpec;spark:SparklineSpec;card:number|undefined;
};
const useDemo=create<Demo>(()=>({
  cells:seed(),selection:{anchor:"F2",focus:"F2"},fills:0,
  tabs:[{id:"0",name:"Summary",tone:"primary"},{id:"1",name:"Q3 Plan"},{id:"2",name:"Audit",isProtected:true}],
  active:"0",freeze:{frozenRows:1,frozenColumns:0},split:undefined,
  chart:{kind:"column",range:"A1:C8",seriesIn:"columns",hasHeader:true,hasXValues:false,title:"Sales and costs",yAxisLabel:"USD"},
  spark:{kind:"line",dataRange:"B2:B8",location:"E2",showHigh:true,showLow:true,showNegative:true,axisMin:"auto"},
  card:undefined,
}));

// Copies the source block's computed values into the target, the way an
// engine fill of constants would. Formula shifting is engine work.
function applyFill(plan:FillPlan){
  const {cells}=useDemo.getState();
  const next={...cells};
  const h=plan.source.endRow-plan.source.startRow+1, w=plan.source.endColumn-plan.source.startColumn+1;
  for(let r=plan.target.startRow;r<=plan.target.endRow;r++)for(let c=plan.target.startColumn;c<=plan.target.endColumn;c++){
    const sr=plan.source.startRow+(((r-plan.source.startRow)%h)+h)%h;
    const sc=plan.source.startColumn+(((c-plan.source.startColumn)%w)+w)%w;
    const from=cells[cellAddress(sr,sc)];
    const addr=cellAddress(r,c);
    if(from)next[addr]={addr,raw:String(from.computed??""),computed:from.computed};
  }
  useDemo.setState(s=>({cells:next,fills:s.fills+1}));
}
function commit(address:string,raw:string){
  const n=Number(raw);
  useDemo.setState(s=>({cells:{...s.cells,[address]:{addr:address,raw,computed:raw.trim()!==""&&Number.isFinite(n)?n:raw}}}));
}

function Grid({width,height,showFormulaBar}:{width?:number;height:number;showFormulaBar?:boolean}){
  const cells=useDemo(s=>s.cells);
  const selection=useDemo(s=>s.selection);
  const freeze=useDemo(s=>s.freeze);
  const spark=useDemo(s=>s.spark);
  const sparkRange=sparklineSpecProblem(spark,parseA1Range)?undefined:parseA1Range(spark.dataRange);
  return <SpreadsheetGrid sheetId="0" sheetName="Summary" rowCount={1_048_576} columnCount={16_384}
    width={width} height={height} cells={cells} selection={selection} showFormulaBar={showFormulaBar}
    frozenRows={freeze.frozenRows} frozenColumns={freeze.frozenColumns}
    onSelectionChange={next=>useDemo.setState({selection:next})}
    onCommitCell={commit} onFillRange={applyFill}
    renderCellContent={(addr,size)=>sparkRange&&addr===spark.location.toUpperCase()?{
      contentLabel:"sparkline of "+spark.dataRange.toUpperCase(),
      content:<Sparkline kind={spark.kind} values={sparklineValues(sparkRange,cells)} width={size.width} height={size.height}
        axisMin={spark.axisMin} showHigh={spark.showHigh} showLow={spark.showLow} showNegative={spark.showNegative}
        accessibilityLabel={"Sparkline of "+spark.dataRange}/>,
    }:undefined}/>;
}

function Sheet(){
  const split=useDemo(s=>s.split);
  const tabs=useDemo(s=>s.tabs);
  const active=useDemo(s=>s.active);
  const set=(fn:(t:SheetTab[])=>SheetTab[])=>useDemo.setState(s=>({tabs:fn(s.tabs)}));
  return <View testID="sheet" {...{className:"rounded-card border border-border bg-surface-raised"}} style={{overflow:"hidden"}}>
    <View style={{height:split?520:380}}>
      {split?<SplitSpreadsheetView split={split} onSplitChange={next=>useDemo.setState({split:next})}
        renderPane={(pane,size)=><Grid width={size.width} height={size.height} showFormulaBar={pane===0}/>}/>
        :<Grid height={380}/>}
    </View>
    <SheetTabs testID="tabs" tabs={tabs} activeId={active} direction={dir}
      onSelect={id=>useDemo.setState({active:id})}
      onAdd={()=>set(t=>[...t,{id:String(Date.now()),name:nextSheetName(t)}])}
      onRename={(id,name)=>{
        if(name.toLowerCase()==="locked")throw new Error("The engine refused that name.");
        set(t=>t.map(x=>x.id===id?{...x,name}:x));
      }}
      onDuplicate={id=>set(t=>{const i=t.findIndex(x=>x.id===id);const copy={...t[i]!,id:String(Date.now()),name:duplicateSheetName(t[i]!.name,t)};return [...t.slice(0,i+1),copy,...t.slice(i+1)];})}
      onMove={(id,to)=>set(t=>{const next=t.filter(x=>x.id!==id);next.splice(to,0,t.find(x=>x.id===id)!);return next;})}
      onRemove={id=>{set(t=>t.filter(x=>x.id!==id));useDemo.setState(s=>({active:s.tabs[0]!.id}));}}
      onProtectedChange={(id,isProtected)=>set(t=>t.map(x=>x.id===id?{...x,isProtected}:x))}
      onToneChange={(id,tone:SheetTabTone|undefined)=>set(t=>t.map(x=>x.id===id?{...x,tone}:x))}/>
  </View>;
}

function Panels(){
  const cells=useDemo(s=>s.cells);
  const selection=useDemo(s=>s.selection);
  const freeze=useDemo(s=>s.freeze);
  const split=useDemo(s=>s.split);
  const chart=useDemo(s=>s.chart);
  const spark=useDemo(s=>s.spark);
  const fills=useDemo(s=>s.fills);
  return <View style={{gap:16}}>
    <FreezeSplitControls testID="freeze" freeze={freeze} focus={selection.focus} split={split}
      onFreezeChange={next=>useDemo.setState({freeze:next})} onSplitChange={next=>useDemo.setState({split:next})}/>
    <ChartBuilder testID="chart" spec={chart} cells={cells} onSpecChange={next=>useDemo.setState({chart:next})}
      renderPreview={(_,data)=><View style={{gap:8}}>
        {data.series.map(s=><View key={s.id} style={{flexDirection:"row",alignItems:"center",gap:8}}>
          <Text {...{className:"text-text-muted"}} style={{width:56}}>{s.label}</Text>
          <Sparkline kind="column" values={s.points.map(p=>p.y)} width={200} height={40} axisMin="zero"/>
        </View>)}
      </View>}
      onInsert={()=>{}}/>
    <SparklineEditor testID="spark" spec={spark} cells={cells} onSpecChange={next=>useDemo.setState({spark:next})}
      onApply={()=>{}}/>
    <View {...{className:"rounded-card border border-border bg-surface-raised"}} style={{padding:16,gap:8}}>
      <Text {...{className:"text-text-muted"}}>Formula in F2</Text>
      <FormulaReferenceText testID="formula" formula={cells.F2?.raw??""} sheetName="Summary"/>
      <Text testID="fills" {...{className:"text-text-muted"}}>{"fills "+fills}</Text>
    </View>
  </View>;
}

function Cards(){
  const cells=useDemo(s=>s.cells);
  const card=useDemo(s=>s.card);
  return <View testID="cards" {...{className:"rounded-card border border-border"}} style={{height:520,overflow:"hidden"}}>
    <SpreadsheetCardsView name="Monthly totals" table={{startRow:0,endRow:7,startColumn:0,endColumn:3}} cells={cells}
      openCard={card} onOpenCardChange={next=>useDemo.setState({card:next})}
      onCommitField={(address,raw)=>{
        if(raw==="fail")throw new Error("The engine rejected this value.");
        commit(address,raw);
      }}
      onClose={()=>{}}/>
  </View>;
}

function Page(){
  return <ScrollView contentContainerStyle={{padding:16,gap:16,maxWidth:1100,width:"100%",alignSelf:"center"}}>
    <Sheet/>
    <Panels/>
    <Cards/>
  </ScrollView>;
}
document.documentElement.dataset.theme=theme;
document.documentElement.dir=dir;
AppRegistry.registerComponent("Spreadsheet",()=>Page);
AppRegistry.runApplication("Spreadsheet",{rootTag:document.getElementById("root")});
