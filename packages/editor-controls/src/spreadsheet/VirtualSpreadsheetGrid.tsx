import {SpreadsheetGrid,type SpreadsheetGridProps} from '../SpreadsheetGrid.tsx';
export type VirtualSpreadsheetGridProps=SpreadsheetGridProps;
/** Canonical entry for the existing two-axis, frozen-pane, window-request grid owner. */
export function VirtualSpreadsheetGrid(props:VirtualSpreadsheetGridProps){return <SpreadsheetGrid {...props}/>;}
