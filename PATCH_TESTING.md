# Storyboard Studio Next 0.12.0 — patch testing list

This list covers the changes in this patch. Test on a duplicate of a representative project first. Keep the entire project folder with Studio Link when copying between computers.

## Supervisor and cleanup edits

1. Run **Check project**. Open its **Last check** report and inspect the file/backup counts and decisions. The check observes the project; it must not import, rename, archive or overwrite artwork by itself.
2. Save/Refresh normally. The supervisor runs after ordinary discovery and organization. It checks permanent card IDs, reusable-source relationships, script links, rough/archive destinations, component positions, missing working/recovery media, project ownership, selected audio, repeated shared-record roles and backup health. Gaps such as 3A/3C are valid.
3. Edit a working cleanup PNG outside the app, with the app open. Change background/color/dimensions, save, then Refresh. Its preview/dimensions/current recovery update; the card connection and stacking order stay intact. Ordinary edits must not produce another archived version.
4. Repeat with the app closed. Reopen and Refresh/Save. The edited artwork remains authoritative. The app must not restore an older recovery over a readable edited working file.
5. Make an unrelated undoable change after refresh, then Undo. The accepted working file/current recovery must remain usable.
6. Repeat an unchanged Save/Check. No new backup or artwork rewrite; a brief message handles an up-to-date result. The stored last-check report only changes when its outcome changes.

## PNG working copies

7. Attach a JPEG to a card; Save. The project working image becomes PNG at its full decoded width/height, with a current recovery copy. The Desktop original remains untouched.
8. Refresh/Save an existing managed JPEG cleanup. Its managed references migrate to PNG safely. Prior unused managed JPEGs go to Trash only after the current PNG and recovery are verified; other live references remain protected.
9. Attach transparent WebP/PNG and inspect its alpha. Transparent pixels must not become white. PNG conversion cannot recreate transparency already lost in JPEG.
10. Attach video or animated GIF. They must retain their animation/media format, rather than being flattened by still-image conversion.

## Tags manager

11. Open Manage tags from a card's right-click menu and from Settings. Every built-in, automatic and custom tag is listed with readable spacing and a pencil.
12. Edit a permanent tag's color and paste an icon/symbol. Save, reopen the manager, and check board/Perform displays. Permanent tag names/deletion are protected; appearance is customizable.
13. Create/edit a custom tag using the same text-based symbol field. Custom tags remain deletable.
14. Select several cards, right-click Manage tags and Apply/remove a manual tag. All selected cards change; automatic Clean up/Modified/etc. remain controlled by actual state.
15. Variants starts red and Clean up starts blue. A saved custom appearance overrides these defaults.

## Archive, restoration and Trash

16. Remove cleanup, open Holding Area → Archive → Cleanups and right-click **Restore to Not Assigned**. Its group appears under Not Assigned → Cleanups, without automatically returning to its previous card.
17. Restore multiple groups with lasso + right-click; component order remains grouped. Drag a restored group onto a chosen card and Save.
18. Right-click **Move selected to Trash…**, or press Delete, and confirm. The archive entry disappears. External originals and files still used by other active/unassigned/archive/reference connections are protected.
19. Use Undo after moving to Trash, then undo another earlier change. It must not resurrect a cleanup pointing at the discarded file version. Recovery from this action uses the operating system's Trash, not Storyboard Studio Undo.
20. Cancel Trash, or make Trash unavailable. Uncompleted entries remain listed and an error explains the failure. Partial completion is reported; no silent permanent deletion fallback is used.
21. Lasso beside/above the first archived image. It selects cards, not browser image/text content. Clean up help still closes with Esc and has its heading plus three numbered bold instructions.

## Perform

22. Expand the Perform view: thumbnail strip/timeline/navigation hide, but a compact Play/Pause remains below. Collapse restores the normal controls.
23. Play across several card changes. Image preload/decode keeps the previous drawing until its replacement is ready, reducing the white blink. Test both cached storyboards and multi-component cleanups. A genuinely missing image still gets its warning.
24. Repeatedly Play/Pause with mouse and Space, including pending seeks/loading. Retest missing audio, Locate audio and recovery from a connected self-contained Subtitler document. Both Prepare Video and Perform must show the same current path/status.

## Editor export — independent optional settings

25. **Split audio at card changes** defaults off. Off exports continuous source clips. On creates adjacent source segments at visual-cue boundaries, once per boundary rather than once per component; stereo channels have identical cut points and source intervals. The original recording is unchanged.
26. **Chapter markers** defaults off. Enable it with chapters 1, 1.1 and 2. Markers follow actual ordered chapter labels and skip the first exported chapter; no hardcoded Chapter 2 assumption.
27. **Export without audio** is independent of the other controls. It bypasses missing-recording requirements and writes no XML audio section. Existing usable cue timings remain unchanged.
28. With no selected recording/no timings, export defaults to no audio and shows a clear equal-length notice. Change **Seconds per card** and verify ordered, equal-duration images/components. It does not claim speech-based cuts exist.
29. With existing timings but the recording moved/missing, choose Export without audio and verify export still works. Including audio still validates its content/duration.
30. Prepare Video → Audio has an obvious **Change…** button next to its clickable audio name; both use the same replacement action.
31. Import XML in Resolve and Premiere. Check V1 storyboard/V2+ cleanup placement, transparent layers, left/right still handles, source audio continuity, optional cuts and markers.
32. Resolve may auto-enlarge small images according to its project settings. For native-size small images, use Project Settings → Image Scaling → Input Scaling → **Center crop with no resizing**. The app's XML scales only larger assets down uniformly. Source resolution/aspect ratio remain unchanged.

## Folder naming

33. Put an unrelated/random image and a subfolder in a chapter folder. Change the chapter-folder pattern, then Save. The whole directory is renamed, including unrelated contents. No old empty directory or separate replacement chapter directory should remain.
34. Repeat for multiple chapters and archived storyboard folders. Registered absolute/relative paths, folder maps and Studio Link records update together; user notes/text do not change.
35. Use a pattern that collides with an existing unrelated folder. The change must stop before moving artwork and explain the collision. It must not merge or overwrite those folders.
36. Reopen the project after a successful rename, then Save/Undo an unrelated change. The app retains the new folder naming/paths rather than recreating the previous layout.

## Build and integration

37. Build/install on the Apple Silicon Mac and confirm **Storyboard Studio Next 0.12.0**, preserving the separate original app and existing project identity/storage.
38. Open a representative older project and test Save, cleanup stacking/discovery, script links, notes/tags in exported blank-card PNGs, Subtitler handoff and relative-path reconnection.
39. FolderExporter is unchanged in this patch. Its update-review/excluded-folder/source-registration improvements remain deferred. Native editor imports and OS Trash/dialog behavior require testing on the receiving applications.

40. Remove a cleanup, restore/reassign it, remove it again, attach a fresh copy and change the chapter-folder pattern. A verified old inactive duplicate must not block the new cleanup. Exact registered duplicates can converge on their existing archive copy; different destination bytes must stop the move and preserve both.
