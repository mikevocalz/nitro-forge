import type {ReactNode} from 'react';
import {View,Text,type ViewProps} from 'react-native';
import {TextSelectionAndCaret,type TextSelectionAndCaretProps} from '../document/TextSelectionAndCaret.tsx';
import {RichTextRibbon,type RichTextRibbonProps} from '../document/RichTextRibbon.tsx';
export type SlideNotesEditorProps=Omit<ViewProps,'children'>&{slideLabel:string;editor:TextSelectionAndCaretProps}&(
 {mode:'plain-text';richEditor?:never;ribbon?:never}|{mode:'native-rich-text';richEditor:ReactNode;ribbon:RichTextRibbonProps});
/** Native notes buffer or an explicit rich-text native editor, sharing the formatting ribbon. */
export function SlideNotesEditor({slideLabel,editor,mode,richEditor,ribbon,style,...props}:SlideNotesEditorProps){
 if(!slideLabel.trim()||slideLabel.length>1024)throw new RangeError('Invalid slide notes context');
 return <View {...props} style={[{gap:8,minWidth:0},style]} accessibilityLabel={'Speaker notes: '+slideLabel}><Text accessibilityRole="header" {...{className:editor.unstyled?undefined:'text-text'}}>Notes for {slideLabel}</Text>{mode==='native-rich-text'?<><RichTextRibbon {...ribbon}/>{richEditor}</>:<TextSelectionAndCaret {...editor}/>}</View>;
}
