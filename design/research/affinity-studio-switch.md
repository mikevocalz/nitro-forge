# Affinity by Canva (v3.x): studio switching inside one .af file. Clean-room evidence ledger

Compiled 2026-11-04. Sources are public web pages only.

## Method and limits

- Affinity is not installed on this Mac. `ls /Applications | grep -i affinity` printed nothing and exited 1. No app UI was studied and no screenshots of the app were taken.
- No app bundle, binary or decompiled code was read. Craft Anything ran with `--clean-room` on every call. Deep mode was never turned on.
- Craft Anything evidence (project `affinity.cany`, bundle `evidence-bundle.json` with 62 records and 0 unknowns, run log, and per-page `capture.json`, `visible-text.txt` and 1440/390 screenshots, all dated 2026-11-04) is kept outside the repository: the screenshots show Affinity's site chrome and the page text is third-party copy. The id-to-URL map is committed as `affinity-evidence-index.tsv` next to this file, so every `[CA:ev_…]` citation resolves to its public URL.
- Citation keys: **[CA:ev_xxxx]** is a Craft Anything record id, given as the first 12 hex characters. The full ids are in `evidence-index.tsv`. **[EXA]** means the quote comes from an Exa search highlight and Craft Anything did not capture the page, either because Cloudflare blocked it ("Just a moment...") or because no capture was attempted. Treat [EXA] lines as lower confidence.
- Several help pages switch content with Desktop and iPad tabs. Craft Anything captured the Desktop tab text. `web_page_states_capture` clicked the iPad tabs, but the screenshot of that state (`help-about-studios-states8/state-4.png`) shows an open site menu covering the article, so **the iPad tab text was not recovered**. `web_walkthrough_record`, which could have clicked the tab and read the result, is refused in clean room (`feature_missing`, reason `clean_room`). The iPad-specific steps on those pages are therefore "no evidence found".
- Third-party tutorial pages (conceptartvl, scrapbookcampus, basic-tutorials, tbreak) describe what their authors saw on screen. They are labelled 3P.

## Source register

| Key | URL | Craft Anything records (open / capture / states) | Local folder |
|---|---|---|---|
| ipad-app | https://www.affinity.studio/ipad-app | ev_375ff4c3e5e4 / ev_c44fbe6f885a / ev_9e4135915dbb | ipad-app/ |
| download | https://www.affinity.studio/download | ev_0064a693ffb5 / ev_695dccc1bce9 / ev_6a5b1345ced6 | download/ |
| release-notes | https://www.affinity.studio/help/release-notes/ (title "September - November 2026 release notes") | ev_4a9ae809b93d / ev_ef9c7bffb2f3 / ev_fe9296dcf75b | release-notes/ |
| appstore | https://apps.apple.com/us/app/affinity-by-canva/id6751323445 | ev_6e16c14efa7f / ev_b7cd0235fc41 / ev_3f44246167fa | appstore/ |
| canva-newsroom (all-new) | https://www.canva.com/newsroom/news/all-new-affinity | ev_2eed9ba64526 / ev_ca35213af89d / ev_f95ecce34e3e (Cloudflare block, no content) | canva-newsroom/ |
| canva-newsroom-ipad | https://www.canva.com/newsroom/news/affinity-for-ipad/ | ev_13ea9f8dc337 / ev_032cebaa2f60 (Cloudflare block, no content) | canva-newsroom-ipad/ |
| artcraft-apps | https://getartcraft.com/apps | ev_e24a8a45b34f / ev_ce0ba7907cae / ev_2b17d26f1bdc | artcraft-apps/ |
| help-about-studios | https://www.affinity.studio/help/workspace-about-studios/ | ev_8aba84c5e372 / ev_b2d0f690e0b4 / ev_9944d64d4477 | help-about-studios/, help-about-studios-states8/ |
| help-customizing-studios | https://www.affinity.studio/help/workspace-customizing-studios/ | ev_1db8606ab952 / ev_cc0532b5d50b / ev_cbf1084144c9 | help-customizing-studios/, help-customizing-studios-states8/ |
| help-key-features-core | https://www.affinity.studio/help/introduction-key-features-core/ | ev_4fe5e07dfd9f / ev_18d6133f43e5 | help-key-features-core/ |
| help-new-features | https://www.affinity.studio/help/introduction-new-features/ | ev_6c8f2cba4529 / ev_b402900d83f3 | help-new-features/ |
| help-system-req | https://www.affinity.studio/help/introduction-system-requirements/ | ev_f18938611d99 / ev_39af82a6fd23 | help-system-req/ |
| blog-ipad-launch | https://www.affinity.studio/blog/affinity-update-ipad-2026 (2 Nov 2026) | ev_3db51f1c5b08 / ev_19ac99f1df39 | blog-ipad-launch/ |
| blog-ipad-drawing | https://www.affinity.studio/blog/affinity-essentials-ipad-drawing | ev_5ae7ced4a161 / ev_4c8852e88c5c | blog-ipad-drawing/ |
| blog-ipad-gestures | https://www.affinity.studio/blog/affinity-essentials-ipad-gestures-shortcuts-apple-pencil | capture ev_9fa52f491efb | blog-ipad-gestures/ |
| blog-lesson8 | https://www.affinity.studio/blog/affinity-essentials-lesson-8-custom-studios | ev_9672ae471575 / ev_b2d805a88882 | blog-lesson8-custom-studios/ |
| blog-lesson3 | https://www.affinity.studio/blog/switching-to-affinity-lesson-3-vector-pixel-layout-in-affinity | ev_ecf163fc19d9 / ev_9ee07757e789 | blog-switching-lesson3/ |
| 3P conceptartvl | https://www.conceptartvl.com/affinity-studio-beginner-course-part-1-overview-user-interface-and-customization/ (desktop) | capture ev_3d9b096e6aaa | 3p-conceptartvl/ |
| 3P scrapbookcampus | https://scrapbookcampus.com/2026/08/understanding-affinity-studios/ (desktop) | capture ev_fd9ae6a13139 | 3p-scrapbookcampus/ |
| 3P basic-tutorials | https://basic-tutorials.com/news/affinity-for-ipad-free-photoshop-alternative-is-here/ | capture ev_2f46eef5fb62 | 3p-basic-tutorials/ |
| 3P tbreak | https://tbreak.com/affinity-for-ipad-free-design-app/ | capture ev_1ae4939fc374 | 3p-tbreak/ |
| 3P appleinsider | https://appleinsider.com/articles/26/11/02/cross-platform-affinity-users-can-finally-update-as-the-app-comes-to-the-ipad | capture ev_c7ce470b06d4 (Cloudflare block, no content) | 3p-appleinsider/ |
| 3P YouTube (Dani Krossing) | https://www.youtube.com/watch?v=VEdmbtSgNkc | not captured, [EXA] transcript highlight | none |
| 3P heybraza | https://heybraza.com/tutorials/affinity-designer/switch-between-vector-pixel-export-modes | not captured, [EXA] | none |

## 1. Shared facts (apply to every pair)

| Fact | Platform | Evidence |
|---|---|---|
| A Studio is a workspace of tools and panels, shown as Toolbar icons | Both | help-about-studios [CA:ev_b2d0f690e0b4]: "A Studio is a workspace that groups tools and panels specific to a design discipline (e.g., vector design, photo editing or page layout) or tailored to a custom way of working. They show in Affinity as Toolbar icons that can be swapped between." |
| Switching studios keeps the same document open | Both | blog-lesson3 [CA:ev_9ee07757e789]: "move between Vector, Pixel, and Layout without leaving the document". help-new-features [CA:ev_b402900d83f3]: "Seamlessly switch between design disciplines by switching Studios ... Avoid app switching and tedious export/import cycles" |
| One .af file holds all disciplines | iPad | ipad-app [CA:ev_c44fbe6f885a]: "One .af file keeps every part of the project in one place, while you work from many. No switching between programs or stitching files back together." |
| Studios were called Personas in V2 | Both | 3P basic-tutorials [CA:ev_2f46eef5fb62]: "which Affinity calls “Studios” (in the previous version, they were called “Personas”)". release-notes [CA:ev_ef9c7bffb2f3], Sept 2026 Mac: "Refines the light interface theme, general UI polish, the home screen, and persona switching" |
| Switching shows only the current discipline's tools and panels | Both | help-about-studios [CA:ev_b2d0f690e0b4]: "By switching Studios to access your chosen discipline, only tools and panels relevant to the current discipline are shown so the interface remains uncluttered" |
| Default desktop studios: Vector, Pixel, Layout, Canva AI. Others hidden until enabled | Desktop | help-about-studios [CA:ev_b2d0f690e0b4] marks Slice, Retouching, Color Grading, Typography, Compositing and Scripting with "* Not displayed by default." 3P scrapbookcampus [CA:ev_fd9ae6a13139]: "Notice that four of them are enabled but several others are not." |
| Liquify, Develop and Tone Mapping are reached from a menu | Desktop | help-about-studios [CA:ev_b2d0f690e0b4]: "Liquify, Develop or Tone Mapping Studios are accessed via Pixel > Filters." |
| iPad studios at start: Sketch, Vector, Pixel, Layout | iPad | ipad-app [CA:ev_c44fbe6f885a]: "Open a new document or an existing file, then pick the studio you need: Sketch, Vector, Pixel, or Layout. Customize your workspace to suit how you work." |
| Sketch Studio description | iPad | help-about-studios [CA:ev_b2d0f690e0b4]: "Sketch Studio—this Studio lets you paint sketches using a simple set of raster brush tools as if you were using real texture brushes." |
| Undo history can be saved in the file (not stated as a switch behavior) | iPad | blog-ipad-launch [CA:ev_19ac99f1df39]: "You can even save your undo history with the file, so there's always a way back." |
| Each studio remembers its own arrangement | Both (tabs labelled Desktop and iPad, Desktop text read) | help-customizing-studios [CA:ev_cc0532b5d50b]: "The Studio’s arrangement will be saved automatically and will be remembered the next time you visit the Studio." |
| Panel arrangements are saved per studio | Both (Desktop text read) | help-customizing-studios [CA:ev_cc0532b5d50b]: "Within each Studio you can customize the default set of panel uniquely for that Studio. These customized panel arrangements are saved with the Studio." and "The visibility of left and right panel groups can be set independently for each Studio." |
| Fill context is a per-studio setting | Both (Desktop text read) | help-customizing-studios [CA:ev_cc0532b5d50b]: "Enable Show fill context as fill and stroke to display fill and stroke color selectors (as in the Vector and Layout Studios), or disable it to show foreground and background selectors (as in the Pixel Studio)." |
| Docked panel layouts saved with the workspace (Nov 2026) | Desktop | release-notes [CA:ev_ef9c7bffb2f3]: "Affinity saves docked panel layouts with your workspace" |
| Studio-switch bug fixes in release notes | Windows | release-notes [CA:ev_ef9c7bffb2f3], Oct 2026 (4940) Windows: "Fixes document focus not changing when switching studios". Nov 2026 (5004) Windows: "Fixes an issue where studio function key shortcuts didn't update when a studio was hidden" |
| Studio rename bug fix | Mac | release-notes [CA:ev_ef9c7bffb2f3], Nov 2026 Mac: "Fixes an issue that prevented default studios from being renamed" |
| Startup reset of studios | Windows (matches Mac) | release-notes [CA:ev_ef9c7bffb2f3]: "Adds the Reset Panel Layout and Reset Studios options to the dialog shown when holding Ctrl at startup, as on Mac" |
| Current iPad version | iPad | appstore [CA:ev_b7cd0235fc41]: "Version 3.3.3 2d ago" (captured 2026-11-04) and "Requires iPadOS 18.0 or later." |
| Persistence of selection across a switch | Both | no evidence found |
| Persistence of zoom or view position across a switch | Both | no evidence found |
| Persistence of the undo stack across a switch | Both | no evidence found |
| Persistence of layer focus or the active layer across a switch | Both | no evidence found |
| Measured or stated switch latency | Both | no evidence found. The only timing words are generic: blog-ipad-launch [CA:ev_19ac99f1df39] "Create at up to 120fps and pinch-zoom through complex artwork without a stutter", not tied to switching. [EXA] appleinsider image caption: "With one click, Affinity users can switch between a full illustration app, a publishing one, or more." Craft Anything capture of that page was blocked. |

## 2. Where the switcher lives

| Item | Platform | Evidence |
|---|---|---|
| Studio buttons on the Toolbar | Desktop | help-about-studios [CA:ev_b2d0f690e0b4]: "On the Toolbar, click the button for the Studio that you want to use." |
| Menu route, Mac | Mac | help-about-studios [CA:ev_b2d0f690e0b4]: "For Mac: On the Affinity menu, click Studios and select from the pop-up menu." |
| Menu route, Windows | Windows | help-about-studios [CA:ev_b2d0f690e0b4]: "For Windows: On the File menu, click Studios and select from the pop-up menu." |
| Position of the studio buttons (3P) | Desktop | 3P conceptartvl [CA:ev_3d9b096e6aaa]: "Next to the Home button are the Studio buttons mainly the Pixel, Vector and Layout buttons." and "Below the Studio buttons, we have the Context Toolbar." 3P scrapbookcampus [CA:ev_fd9ae6a13139]: "You can identify on the top of your screen." |
| Conflicting 3P claim of a left-side bar | Desktop | [EXA] heybraza: "in the new affinity it's the studio bar down the left side." Not captured. It contradicts the two captured 3P pages and is unresolved. |
| Function keys per studio | Desktop | help-customizing-studios [CA:ev_cc0532b5d50b]: "A Function key (e.g., F5) will automatically be assigned to the new Studio (this can be customized in Keyboard shortcuts)." Windows bug fix in release-notes above confirms studio function key shortcuts exist. |
| Studio Manager opens the full studio list | Desktop | 3P conceptartvl [CA:ev_3d9b096e6aaa]: "You can also show additional Studio buttons by clicking on this button right here, the Studio Manager." 3P scrapbookcampus [CA:ev_fd9ae6a13139]: "By clicking on the three dots beside those studios, you will get a list of more available studios." |
| Studio button display style | Both (Desktop text read) | help-customizing-studios [CA:ev_cc0532b5d50b]: "Right-click any Studio’s icon and select Icon and Text, Icon Only or Auto. The Auto option only shows the Studio name when that Studio is active." |
| Switcher location on iPad | iPad | no evidence found. The iPad tab on help-about-studios was clicked [CA:ev_9944d64d4477] but its text was not recovered (see Method). |
| Switch gesture or shortcut on iPad | iPad | no evidence found. blog-ipad-gestures [CA:ev_9fa52f491efb] lists "Quick Actions and the Command Controller" but does not mention studios. |

## 3. Pair ledger: Pixel to Vector

| Aspect | Desktop | iPad |
|---|---|---|
| Persists: selection | no evidence found | no evidence found |
| Persists: zoom | no evidence found | no evidence found |
| Persists: undo stack | no evidence found | no evidence found |
| Persists: layer focus | no evidence found | no evidence found |
| Persists: document view | 3P conceptartvl [CA:ev_3d9b096e6aaa]: "At the moment we are in the Pixel Studio. Let’s switch over to the Vector Studio. Okay, so there’s no change there." (main document view) | no evidence found |
| Changes: tool rail | 3P conceptartvl [CA:ev_3d9b096e6aaa]: "The Tools that are shown in the Main Toolbar will change depending on the Studio that we are using." | no evidence found beyond the shared help text in section 1 |
| Changes: panels | help-customizing-studios [CA:ev_cc0532b5d50b], per-studio panel arrangements (section 1). No list of which panels differ between Pixel and Vector was found. | no evidence found |
| Changes: color selectors | help-customizing-studios [CA:ev_cc0532b5d50b]: fill and stroke "as in the Vector and Layout Studios", foreground and background "as in the Pixel Studio" | no evidence found for iPad specifically |
| Changes: context bar | 3P conceptartvl [CA:ev_3d9b096e6aaa]: "The Tool Options and Settings will change depending on the Tool that is selected." This ties the context toolbar to the tool, not the studio. | no evidence found |
| Latency | no evidence found | no evidence found |

## 4. Pair ledger: Vector to Layout

| Aspect | Desktop | iPad |
|---|---|---|
| Persists: selection, zoom, undo, layer focus | no evidence found | no evidence found |
| Changes: document view | 3P conceptartvl [CA:ev_3d9b096e6aaa]: "Let’s go to the Layout Studio. For the Layout Studio, I can see my Pages and Master Pages, very similar to Adobe InDesign." | no evidence found |
| Changes: tool rail | 3P conceptartvl [CA:ev_3d9b096e6aaa]: "If I were to change to the Vector Studio or the Layout Studio, you’ll notice that the Tools will change accordingly." | no evidence found |
| Shared tools across studios | 3P scrapbookcampus [CA:ev_fd9ae6a13139]: "Some tools appear in more than one studio because they are useful in different types of projects." Its example is the Place tool: "It is in the Layout studio and the Vector studio." | no evidence found |
| Changes: color selectors | Both use fill and stroke selectors (help-customizing-studios quote in section 3) | no evidence found |
| Changes: context bar | no evidence found beyond the tool-driven context toolbar | no evidence found |
| Latency | no evidence found | no evidence found |

## 5. Pair ledger: Sketch to Vector (iPad)

| Aspect | Evidence |
|---|---|
| Availability | iPad only per ipad-app [CA:ev_c44fbe6f885a]: "The iPad app is designed for touch, with Sketch Studio, Apple Pencil support, and gestures". help-about-studios lists Sketch Studio without a "Desktop only" or "iPad only" mark. Whether desktop has it: no evidence found. |
| Content persists across the switch (same file) | appstore [CA:ev_b7cd0235fc41]: "When you're done with the drawing, switch from Sketch Studio to Vector Studio and build real curves, paths, and nodes straight over what you drew. It all happens in the same file, in real time." |
| Same flow, official blog | blog-ipad-launch [CA:ev_19ac99f1df39]: "When you're ready to refine, switch straight to Vector Studio and start shaping your sketch with professional curve and node tools." |
| Studios in one document | blog-ipad-drawing [CA:ev_4c8852e88c5c]: "you’ll see how the Sketch, Vector, and Pixel Studios keep your workflow connected in one document." |
| Changes: tool rail | Sketch: help-about-studios [CA:ev_b2d0f690e0b4] "a simple set of raster brush tools". Vector: "core vector-design tools". Exact rail contents: no evidence found. |
| Sketch strokes become vectors (a tool, not the switch) | 3P tbreak [CA:ev_1ae4939fc374]: "Sketches stay live in the file, and a Sketch to Shapes tool turns hand-drawn forms into editable vector shapes." release-notes [CA:ev_ef9c7bffb2f3], desktop Sept 2026: "Pencil Tool: Sketch to Shape Converts a freehand pencil stroke into a clean shape on hover" |
| Persists: selection, zoom, undo, layer focus | no evidence found |
| Changes: panels, context bar | no evidence found |
| Latency | no evidence found. The phrase "in real time" (appstore) describes editing, not a switch time. |

## 6. Creating and recalling a custom studio

Help pages mark each step with Desktop and iPad tabs. Only the Desktop text was read, so iPad wording may differ.

| Step | Tabs on page | Evidence: help-customizing-studios [CA:ev_cc0532b5d50b] unless noted |
|---|---|---|
| Create from an existing studio | Desktop, iPad | "Select a Studio on which to base your new Studio. Click the Studio Manager, and select Create Studio." |
| Dialog fields | Desktop, iPad | Image or icon preset, "Remove icon color", "Set the Studio color that will be the Studio's background color when selected", "Show fill context as fill and stroke", a description "when its icon is hovered over", then "Click Create." |
| Create a blank studio | Desktop, iPad | "configure settings ensuring Clone from is set to None." |
| Recall: function key | Desktop text | "A Function key (e.g., F5) will automatically be assigned to the new Studio" |
| Recall: studio button, menu | Desktop | section 2 quotes |
| Update the studio's default | **Desktop tab only** | "How to update a Studio's default Desktop Right-click the Studio’s icon and select Update <studio name>." No iPad tab appears for this step in the captured text. Whether iPad has the feature: no evidence found. |
| Revert to updated default | Desktop, iPad | "Right-click the Studio’s icon and select Revert <studio name>." |
| Reset to master | Desktop, iPad | "Right-click the Studio’s icon and select Reset <studio name> to Master." |
| Edit name, icon, color, fill context | Desktop, iPad | "Click Studio Manager. Right-click a Studio and select Edit" |
| Hide, show, reorder | Desktop, iPad | "disable or enable the Studio entry" and "drag the Studio entry to your preferred position." |
| Export and import | Desktop, iPad | Export: "Name the .afstudio file. Click Save." Import: "Select the .afstudio file. Click Open." |
| Delete | Desktop, iPad | "Click Studio Manager, then right-click the Studio entry, and select Delete." |
| Panel presets inside a studio | Desktop, iPad | "On the Window menu, select Panels > Add Preset." and "Panels > Manage Presets" |
| Sharing a studio, official lesson | Desktop | blog-lesson8 [CA:ev_b2d805a88882]: "know how to share a custom studio with someone else" |
| How right-click maps to touch on iPad | iPad | no evidence found |
| Download page mention | Desktop | download [CA:ev_695dccc1bce9]: "custom capabilities that allow you to rearrange panels and combine tools to build your own unique studios." |

## 7. iPad and desktop differences

| Difference | Evidence |
|---|---|
| Sketch Studio is promoted as an iPad feature | ipad-app [CA:ev_c44fbe6f885a], quote in section 5 |
| Slice Studio is desktop only | help-about-studios [CA:ev_b2d0f690e0b4]: "Slice Studio*—... Desktop only." and "Slice Studio (desktop only)" |
| First-launch input choice on iPad | [EXA] appleinsider: "Now when you first open Affinity on the iPad, it asks whether you are planning to use primarily touch or the Apple Pencil." Not captured (Cloudflare). |
| Same .af files across devices | ipad-app [CA:ev_c44fbe6f885a]: "You can work on the same .af files across devices" |
| Parity claim | release-notes [CA:ev_ef9c7bffb2f3]: "The free all-in-one app offers feature parity with its desktop equivalent". The missing-feature list below qualifies this. |
| Keyboard shortcuts on iPad | appstore [CA:ev_b7cd0235fc41], user review dated "1d ago": "The only feature still missing is keyboard shortcut support." One user's report, not an official statement. |
| Studio switching on iPad vs desktop (location, gesture, speed) | no evidence found |

## 8. Missing features per surface

| Surface | Missing | Evidence |
|---|---|---|
| iPad at launch | Books, Batch, Data Merge, Quick Adjustments, Info and Scope panels, recording macros, Astrophotography Studio | ipad-app [CA:ev_c44fbe6f885a]: "Some desktop features aren’t on iPad at launch, including the Books, Batch, Data Merge, Quick Adjustments, Info and Scope panels, recording macros, and Astrophotography Studio." The same list appears in 3P tbreak [CA:ev_1ae4939fc374]. |
| iPad | Slice Studio | help-about-studios [CA:ev_b2d0f690e0b4] ("Desktop only") |
| iPad | Keyboard shortcuts (user report) | appstore [CA:ev_b7cd0235fc41], review quote in section 7 |
| iPad, per studio (Sketch, Vector, Pixel, Layout) | Per-studio list | no evidence found. The public list is app-wide. |
| Desktop | Sketch Studio | no evidence found either way |
| Desktop, Mac | Panels dock below the document only for Script Editor and Log Console | release-notes [CA:ev_ef9c7bffb2f3]: "In this release, panels on Mac can dock only below the document view" |

## 9. Craft App Suite conventions (getartcraft.com/apps)

| Item | Evidence |
|---|---|
| Studio or workspace switching convention | no evidence found. artcraft-apps [CA:ev_ce0ba7907cae] lists sixteen separate apps ("Sixteen apps. One craft.") and "ArtCraft Studio, our AI image and video app". The page never describes switching workspaces inside one app. |

## 10. Open unknowns

1. What happens to the selection, zoom, undo stack and active layer when the studio changes. No public page states it.
2. Switch latency on any platform. No measurement or stated figure was found. Measuring it needs the installed app.
3. Where the switcher sits on iPad and how it is triggered by touch. The help page has an iPad tab whose text was not recovered under clean room.
4. Whether "Update <studio name>" exists on iPad. The help page shows only a Desktop tab for that step.
5. Whether Sketch Studio exists on desktop.
6. Whether the studio bar is at the top or on the left on desktop. Two captured 3P pages say top. One uncaptured page says left.
