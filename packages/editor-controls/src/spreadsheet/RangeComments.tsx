import {CommentsThreadPanel,type CommentsThreadPanelProps} from '../pdf/CommentsThreadPanel.tsx';
export interface RangeCommentsProps extends Omit<CommentsThreadPanelProps,'groupBy'|'describeLocation'> {
 /** Actual workbook/sheet/range label per thread, e.g. Budget!B4:E9. */
 anchors:Readonly<Record<string,string>>;
}
export function RangeComments({anchors,...props}:RangeCommentsProps){
 if(props.threads.some(t=>!anchors[t.id]?.trim()||anchors[t.id]!.length>2048))throw new RangeError('Range comments require actual range anchors');
 return <CommentsThreadPanel {...props} label={props.label??'Range comments'} groupBy="none" describeLocation={thread=>anchors[thread.id]!}/>;
}
