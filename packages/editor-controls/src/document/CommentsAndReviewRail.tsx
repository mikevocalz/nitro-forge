import {CommentsThreadPanel,type CommentsThreadPanelProps} from '../pdf/CommentsThreadPanel.tsx';
export type CommentsAndReviewRailProps=CommentsThreadPanelProps;
/** One threaded-comment owner shared by office documents, PDF and range review. */
export function CommentsAndReviewRail(props:CommentsAndReviewRailProps){return <CommentsThreadPanel {...props} label={props.label??'Document review comments'}/>;}
