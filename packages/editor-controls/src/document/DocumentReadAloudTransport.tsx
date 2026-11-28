import {ReadAloudTransport,type ReadAloudTransportProps} from "../office/ReadAloudTransport.tsx";

/** Props for {@linkcode DocumentReadAloudTransport}. */
export interface DocumentReadAloudTransportProps extends Omit<ReadAloudTransportProps,"context"|"label"> {
  /**
   * Names the part of the document a block belongs to, usually the nearest
   * heading above it ("Budget › Travel"). Shown above the sentence.
   */
  readonly describeBlock?:(block:number)=>string|undefined;
  /** @default "Read document aloud" */
  readonly label?:string;
}

/**
 * Read Aloud for a text document (H-21). Sentences come from the document's
 * blocks (`readAloudSentences` with each block's index); the app highlights
 * `sentences[index]` (block, start, end) in the editor and moves the caret
 * there when reading stops.
 */
export function DocumentReadAloudTransport({describeBlock,label="Read document aloud",...rest}:DocumentReadAloudTransportProps){
  const current=rest.sentences[Math.min(Math.max(rest.index,0),Math.max(rest.sentences.length-1,0))];
  const context=current&&describeBlock?describeBlock(current.block):undefined;
  return <ReadAloudTransport {...rest} label={label} {...(context?{context}:{})}/>;
}
