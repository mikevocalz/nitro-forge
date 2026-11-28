/** Why the host paused or recovered audio. No player/native resource is stored here. */
export type AudioRecoveryNotice=
 | {readonly kind:'paused';readonly reason:'interruption'|'output-lost';readonly ready:boolean}
 | {readonly kind:'reset'}
 | {readonly kind:'recording';readonly filename:string;readonly durationSeconds?:number};
/** Visible title for the recovery dialog. */
export function recoveryTitle(notice:AudioRecoveryNotice):string{
 return notice.kind==='recording'?'Recording recovered':notice.kind==='reset'?'Audio needs to restart':notice.reason==='output-lost'?'Audio output disconnected':'Audio interrupted';
}
/** Explains the actual host state without promising a saved recording or automatic resume. */
export function recoveryMessage(notice:AudioRecoveryNotice):string{
 if(notice.kind==='recording')return `“${notice.filename}” is available. Keep it or discard it.`;
 if(notice.kind==='reset')return 'The operating system restarted its audio services. Rebuild the audio session before playing again.';
 if(notice.reason==='output-lost')return 'Playback is paused. Check the output before resuming so audio does not jump to the speaker.';
 return notice.ready?'The interruption ended. Resume when you are ready.':'Another app or call is using audio. Playback stays paused.';
}
