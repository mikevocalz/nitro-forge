# F4 references: Nitro Forge launcher icon family and launcher labels

Date: 2026-11-11, references section replaced 2026-11-12

## §3.3 step 2 status: NOT MET

§3.3 step 2 asks for at least three Mobbin references per surface, iPad only, with Dribbble where Mobbin has no iPad coverage. Neither source produced an iPad reference this gate can use, so step 2 is not met for either surface (launcher icon family, launcher label and About/title bar).

The first version of this file (commit 07aca25) listed 20 rows from iPhone screens, desktop web pages and Dribbble shots chosen from their titles. R2 rejected them. They are removed here; none of them counts as an iPad reference.

### Mobbin, 2026-11-12

The MCP tools take `platform: ios` or `web`; there is no iPad value. Every `ios` result below was an iPhone capture (iPhone status bar, Dynamic Island, single column), and every `search_sections` result was a desktop web page.

| Tool | Query | What came back |
|---|---|---|
| `search_screens` ios | iPad home screen with app icons and labels | Expedia, Brainly, CapCut, talabat, Trainline (alternate icon picker), Lemonade, Insight Timer, Waymo. All iPhone. No home screen. |
| `search_screens` ios | Procreate gallery screen | Five Procreate Pocket screens (the iPhone app). No Procreate for iPad. |
| `search_screens` ios | Microsoft Word iPad document editor | TradingView, ChatGPT, Google Calendar, Shopify. All iPhone. No Microsoft app. |
| `search_flows` ios | iPad creative app about screen with version and app info | About flows from Kino, Craft, DailyArt and Etsy. All iPhone. |
| `search_sections` | app suite icon family section showing several product app icons | Whop (twice), Airbnb, ClickUp, Sketch. Desktop web. |

### Dribbble

Web search found shots that may show iPad screens or suite icon families: https://dribbble.com/shots/2384373-iPad-Lockscreen, https://dribbble.com/shots/245556-iPad-app-icons-2, https://dribbble.com/shots/1766449-Canva-iPad-App-Icon, https://dribbble.com/shots/10563457-Craft-do-for-iPad-craft-structured-documents-on-your-iPad, https://dribbble.com/shots/13006132-Drawing-App-iPad-Pro, https://dribbble.com/shots/21212599-Creativit-iPad-App. None of their images could be opened from this session: dribbble.com answers a plain request with an empty HTTP 202 bot-check page, the text extractor returns the description without image links, and the Chrome extension was not connected. They are not used as references, because nobody has looked at them.

### To meet step 2

Someone with a browser opens those shots (or captures Affinity, Adobe Fresco, Procreate, Logic Pro or Office on an iPad) and records three per surface with what each image shows.

## Platform label guidance

| Platform | URL | What it publishes (quoted) |
|---|---|---|
| Apple, Info.plist `CFBundleDisplayName` | https://developer.apple.com/documentation/bundleresources/information-property-list/cfbundledisplayname | "The user-visible name for the bundle, used by Siri and visible on the iOS Home screen." "Use this key if you want a product name that's longer than CFBundleName." Publishes no character limit or width. |
| Apple, Info.plist `CFBundleName` | https://developer.apple.com/documentation/bundleresources/information-property-list/cfbundlename | "A user-visible short name for the bundle." "This name can contain up to 15 characters. The system may display it to users if CFBundleDisplayName isn't set." |
| Apple, App Store Connect app information | https://developer.apple.com/help/app-store-connect/reference/app-information/app-information | Name: "The name must be at least two characters and no more than 30 characters." Subtitle: "This can't be longer than 30 characters." (This is the store name. The Home Screen label is `CFBundleDisplayName`.) |
| Apple HIG, App icons | https://developer.apple.com/design/human-interface-guidelines/app-icons | Publishes no label length. Relevant lines: "In some contexts, your app name already appears nearby, making it redundant to display the name within the icon itself. Although displaying a mnemonic like the first letter of your app's name can help people recognize your app or game, avoid including nonessential words..." and "Keep primary content centered to avoid truncation when the system adjusts corners or applies masking." |
| Android, manifest `<application>` `android:label` | https://developer.android.com/guide/topics/manifest/application-element | "A user-readable label for the application as a whole and a default label for each of the application's components." "The label is set as a reference to a string resource, so that it can be localized like other strings in the user interface." Publishes no character limit. |
| Android, adaptive icons | https://developer.android.com/develop/ui/views/launch/icon_design_adaptive | Publishes no label guidance. Icon geometry: "Size all layers to 108x108 dp." "Use a logo that's at least 48x48 dp. It must not exceed 66x66 dp, because the inner 66x66 dp of the icon appears within the masked viewport." "The outer 18 dp on each of the four sides of the layers is reserved for masking..." |
| Google Play, store listing | https://support.google.com/googleplay/android-developer/answer/9859152 | App name "Your app's name on Google Play.": 30 characters. Short description: 80 characters. Limits "apply to both full-width and half-width characters." (Store name, not the launcher label.) |
| Microsoft, reserve MSIX app name | https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/reserve-your-apps-name | "Keep it short. Although your app's name can have up to 256 characters, display space is limited, and longer names may be truncated depending on the user's screen and settings." "Windows uses variable-width fonts. This means the number of visible characters depends on their width (e.g., 30 'i' characters fit in the same space as 10 'w' characters)." "Avoid trailing differentiators... Such details may be cut off in some views." |
| Microsoft, Tiles for Windows apps (UWP) | https://learn.microsoft.com/en-us/windows/apps/design/shell/tiles-and-notifications/creating-tiles | "ShortName: Because there is limited room for your display name to fit on tiles, we recommend that you to specify a ShortName as well, to make sure your app's name doesn't get truncated." Also: "Lives Tiles are a Windows 10 feature that is not supported on later versions of Windows." Publishes no number. |

## Takeaways for drawing and naming

- The one published hard number for a short app name is Apple's 15 characters for `CFBundleName`. All seven studio names (Prism, Quill, Tally, Pitch, Folio, Splice, Cadence) fit with room to spare. "Nitro Forge" is 11 characters.
- No platform publishes a Home Screen label width. Microsoft says outright that visible length depends on glyph width. Test the labels on a real iPad Home Screen at the default and the largest text size.
