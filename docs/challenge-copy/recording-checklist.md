# Stage 1 recording and submission checklist

The release is ready to submit only when the public URLs, exact commit, native WebMCP smoke, final
video, and Devpost receipt all refer to the same pinned Stage 1 build.

## Identity record

Fill this once, then reuse the values everywhere:

| Field                         | Final value                    |
| ----------------------------- | ------------------------------ |
| Public live URL               | `[LIVE_PAGES_URL]`             |
| Health URL                    | `[LIVE_PAGES_URL]/health.json` |
| Public repository URL         | `[PUBLIC_REPOSITORY_URL]`      |
| Final commit SHA              | `[FINAL_COMMIT_SHA]`           |
| Visible short SHA             | `[SHORT_COMMIT_SHA]`           |
| Cloudflare deployment ID      | `[DEPLOYMENT_ID]`              |
| Native Chrome version         | `[CHROME_VERSION]`             |
| WebMCP host/environment       | `[WEBMCP_HOST_AND_VERSION]`    |
| Final video file              | `[ABSOLUTE_VIDEO_PATH]`        |
| Public YouTube URL            | `[PUBLIC_YOUTUBE_URL]`         |
| Devpost submission ID         | `[DEVPOST_SUBMISSION_ID]`      |
| Submission timestamp and zone | `[SUBMITTED_AT]`               |

## 1. Freeze and verify the product

- [ ] Confirm the exact eight tools in `docs/evidence/webmcp-tools.json`: `get_canvas_context`,
      `list_components`, `inspect_elements`, `create_elements`, `update_elements`,
      `delete_elements`, `arrange_elements`, and `export_document`.
- [ ] Run `pnpm run doctor`, `pnpm challenge:verify`, `pnpm audit:browser`, and `pnpm ready` from a
      clean release tree; preserve the resulting evidence.
- [ ] Deploy the exact clean commit to the dedicated Cloudflare Pages challenge project.
- [ ] Run `KOI_AUDIT_URL=[LIVE_PAGES_URL] pnpm audit:browser` against HTTPS, not localhost.
- [ ] Open `[LIVE_PAGES_URL]/health.json` and verify `status`, version, full build ID, and deployment
      mode match the intended commit. Confirm no secret or private endpoint appears.
- [ ] From a clean browser profile, verify the app loads, all eight native tools are discoverable,
      one bounded read works, one write visibly changes the canvas, reload preserves it, a human
      edit works, and a second agent read observes that edit.
- [ ] Record the exact browser version, URL, commit, host, result, console status, network status,
      mixed-content status, CSP status, and storage status in the release evidence.
- [ ] Verify the submitted public repository from a fresh temporary clone:

Install the pnpm release declared by `packageManager` first, using `corepack enable` when Corepack
is available or `npm install --global pnpm@11.21.0` when it is not. Corepack is optional when the
exact pnpm release is already installed.

```sh
git clone [PUBLIC_REPOSITORY_URL]
cd koi-design
pnpm --version
pnpm install --frozen-lockfile
pnpm ready
```

## 2. Complete account-bound preparation

- [ ] **[OWNER ACTION]** Recheck the current official Devpost and OpenAI challenge rules, required
      fields, eligibility, deadline, and video visibility immediately before recording/submission.
- [ ] **[OWNER ACTION]** Change the repository to public only after the local and clean-clone gates
      pass. Verify it while logged out.
- [ ] **[OWNER ACTION]** Authenticate the native browser/agent environment needed for the live
      WebMCP take. Use a dedicated demo profile where possible.
- [ ] **[OWNER ACTION]** Prepare the YouTube and Devpost accounts. Keep those account pages out of
      the product recording.
- [ ] **[OWNER ACTION]** Decide whether Hyperframes or Remotion will assemble the final edit. Either
      is acceptable; the result must still show genuine native WebMCP interaction.

## 3. Privacy and capture safety

- [ ] Use a clean desktop and browser profile. Hide the bookmarks bar, unrelated tabs, downloads,
      menu-bar account names, terminal history, and desktop files.
- [ ] Enable Do Not Disturb and close chat, mail, calendar, password manager, clipboard manager,
      and cloud-sync notifications.
- [ ] Never record GitHub, Cloudflare, OpenAI, Google, or Devpost tokens; `.env` files; cookies;
      request authorization headers; private repository settings; or browser sync identity.
- [ ] Do not open raw IndexedDB records, the full `export_document` source, or private console
      history during the take. A tool name, bounded result summary, and sanitized receipt are
      sufficient.
- [ ] Use only the seeded Koi Document and the fixed demo copy. Check the canvas and agent
      transcript for personal names, private URLs, or prior prompts before pressing Record.
- [ ] Confirm the visible build label is correct without exposing local filesystem paths.
- [ ] Record a ten-second privacy test, inspect every edge of the frame, then discard it before the
      real take.

## 4. Audio and picture setup

- [ ] Capture at `[1920x1080]`, `[30]` fps, with browser zoom at `[100%]`. Use a higher source
      resolution only if the final 1080p text remains sharper after downscaling.
- [ ] Keep Koi's canvas dominant and the agent call feed large enough to read tool names. Avoid
      zooming raw JSON to full screen.
- [ ] Record clean voice audio at `[48 kHz]`; remove hum and keyboard spikes without making the
      voice sound processed.
- [ ] Target roughly `-16` to `-14 LUFS` integrated loudness and no peak above `-1 dBTP`, or verify
      equivalent clear, non-clipping speech by ear if loudness metering is unavailable.
- [ ] Rehearse the 2:48 shot list twice. The first genuine successful take is preferable to a
      transcript assembled from unrelated tool calls.
- [ ] Leave enough cursor travel time for viewers to follow; accelerate only reload/build waits,
      and disclose any time compression with a small on-screen label.

## 5. Required on-screen proof

- [ ] Opening shows the public HTTPS URL, seeded canvas, **WebMCP ready**, browser-local challenge
      pill, and correct build identifier.
- [ ] Discovery shows all eight exact Stage 1 tool names.
- [ ] First agent loop visibly calls `get_canvas_context`, `list_components`,
      `inspect_elements`, and `create_elements`.
- [ ] Canvas visibly gains `demo-review-card` and `demo-review-button`; the tool receipt reports
      `applied`.
- [ ] An uncut reload restores both new Elements from IndexedDB.
- [ ] Human directly edits `brief-note` and drags `demo-review-button`.
- [ ] Second agent loop calls `inspect_elements` again and visibly observes the newer human state
      before `update_elements` and `arrange_elements` refine the result.
- [ ] Architecture shot shows all three entry surfaces converging on the shared command/query core.
- [ ] Closing frame shows the real public live and repository URLs.
- [ ] No statement implies that `delete_elements` or `export_document` was executed if each was
      only shown in discovery.

## 6. Encode and verify the final file

- [ ] Export a broadly compatible MP4: H.264/AVC video, `yuv420p` pixel format, AAC audio, 48 kHz,
      stereo or mono.
- [ ] Target duration: `00:02:48`. Required duration: strictly less than `00:03:00`.
- [ ] Fill the probe result below. If `ffprobe` is available, run:

```sh
ffprobe -v error \
  -show_entries format=duration,format_name:stream=index,codec_type,codec_name,pix_fmt,width,height,r_frame_rate,sample_rate,channels \
  -of json \
  [ABSOLUTE_VIDEO_PATH]
```

```text
Verified duration: [SECONDS] seconds
Container: [FORMAT_NAME]
Video: [CODEC_NAME], [PIX_FMT], [WIDTH]x[HEIGHT], [FRAME_RATE]
Audio: [CODEC_NAME], [SAMPLE_RATE] Hz, [CHANNELS] channel(s)
Checked by: [NAME]
Checked at: [TIMESTAMP_AND_ZONE]
```

- [ ] Watch the exported file from beginning to end with headphones. Confirm narration is present,
      synchronized, intelligible, and free of clipped words.
- [ ] Pause on every tool-call shot and verify names, Element IDs, versions, URLs, and receipts are
      readable and accurate.
- [ ] Verify there are no blank frames, notification flashes, cursor trails, accidental cuts across
      claimed persistence, or Stage 2 mockups presented as working behavior.
- [ ] Record the final file's SHA-256 as `[VIDEO_SHA256]` so later edits cannot be confused with the
      submitted artifact.

## 7. Publish and submit

- [ ] **[OWNER ACTION]** Upload the final video to YouTube with public visibility, audio enabled,
      and no age, region, login, or permission restriction. Record `[PUBLIC_YOUTUBE_URL]`.
- [ ] **[OWNER ACTION]** Open the YouTube URL in a logged-out/private window and verify 1080p
      playback, captions if supplied, audio, and a displayed duration under three minutes.
- [ ] **[OWNER ACTION]** Paste the final live URL, repository URL, video URL, project copy, team and
      category metadata into Devpost. Supply no credentials because the intended build is
      anonymous.
- [ ] **[OWNER ACTION]** Preview the Devpost entry while logged out and test every link.
- [ ] **[OWNER ACTION]** Submit, save the confirmation as PDF or screenshots, and record
      `[DEVPOST_SUBMISSION_ID]` plus `[SUBMITTED_AT]`.
- [ ] Tag the exact submitted commit as `webmcp-challenge-submission-2026` and push the tag.
- [ ] Record live URL, public repository URL, public YouTube URL, submission ID, exact commit SHA,
      deployment ID, and confirmation artifact path in `docs/evidence/challenge-submission.md`.
- [ ] Pin the Stage 1 challenge deployment until judging ends. Do not deploy Stage 2 breaking
      changes over the submitted URL.

## Final sign-off

```text
[ ] The public app, source, video, and Devpost entry all identify the same Stage 1 commit.
[ ] The live no-account path works from a clean profile.
[ ] The video is public, has audio, and is under 180 seconds.
[ ] Every WebMCP claim is visible or linked to public evidence.
[ ] Current limitations are stated plainly; no Stage 2 capability is presented as complete.
[ ] Submission confirmation and exact release identifiers are preserved.
```
