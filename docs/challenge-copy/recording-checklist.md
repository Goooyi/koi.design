# Stage 1 recording and submission checklist

The release is ready to submit only when the public URLs, deployed application commit, native
WebMCP smoke, final video, and Devpost receipt identify the same Stage 1 application artifact, and
the later evidence-only repository commit is recorded separately.

## Identity record

Fill this once, then reuse the values everywhere:

| Field                                | Final value                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------ |
| Public live URL                      | `https://koi-design-webmcp-challenge.pages.dev/`                               |
| Health URL                           | `https://koi-design-webmcp-challenge.pages.dev/health.json`                    |
| Public repository URL                | `https://github.com/Goooyi/koi.design`                                         |
| Deployed application SHA             | `c31366f3ae3a7a58af56b9e7f7933bda4491b694`                                     |
| Visible application short SHA        | `c31366f3ae3a`                                                                 |
| Public repository HEAD at submission | `[REPOSITORY_HEAD_AT_SUBMISSION]`                                              |
| Cloudflare deployment ID             | `78efad47-5d7f-4b20-9b15-a9048dfdb2cb`                                         |
| Native Chrome version                | `151.0.7922.174`                                                               |
| WebMCP host/environment              | Stable Chrome with native WebMCP testing                                       |
| Final video file                     | `release-artifacts/stage1/koi-design-webmcp-challenge.mp4` (local, gitignored) |
| Public YouTube URL                   | `[PUBLIC_YOUTUBE_URL]`                                                         |
| Devpost submission ID                | `[DEVPOST_SUBMISSION_ID]`                                                      |
| Submission timestamp and zone        | `[SUBMITTED_AT]`                                                               |

## 1. Freeze and verify the product

- [x] Confirm the exact eight tools in `docs/evidence/webmcp-tools.json`: `get_canvas_context`,
      `list_components`, `inspect_elements`, `create_elements`, `update_elements`,
      `delete_elements`, `arrange_elements`, and `export_document`.
- [x] Run `pnpm run doctor`, `pnpm challenge:verify`, `pnpm audit:browser`, and `pnpm ready` from a
      clean release tree; preserve the resulting evidence.
- [x] Deploy the exact clean commit to the dedicated Cloudflare Pages challenge project.
- [x] Run `KOI_AUDIT_URL=https://koi-design-webmcp-challenge.pages.dev/ pnpm audit:browser` against HTTPS, not localhost.
- [x] Open `https://koi-design-webmcp-challenge.pages.dev/health.json` and verify `status`, version, full build ID, and deployment
      mode match the intended commit. Confirm no secret or private endpoint appears.
- [x] Complete the bounded manual keyboard, focus, zoom-equivalent, and reduced-motion review; keep
      its known limitations in `docs/evidence/manual-accessibility.md` and the submission copy.
- [x] From a clean browser profile, verify the app loads, all eight native tools are discoverable,
      one bounded read works, one write visibly changes the canvas, reload preserves it, the
      human-input path works, and a second agent read observes that edit.
- [x] Record the exact browser version, URL, commit, host, result, console status, network status,
      mixed-content status, CSP status, and storage status in the release evidence.
- [x] Verify the submitted public repository from a fresh temporary clone:

Install the pnpm release declared by `packageManager` first, using `corepack enable` when Corepack
is available or `npm install --global pnpm@11.21.0` when it is not. Corepack is optional when the
exact pnpm release is already installed.

```sh
git clone https://github.com/Goooyi/koi.design
cd koi-design
pnpm --version
pnpm install --frozen-lockfile
pnpm ready
```

## 2. Complete account-bound preparation

- [x] Recheck the current official Devpost and OpenAI challenge rules before publication. On
      2026-09-03 they require a working live URL, public licensed source, an English description,
      and a public YouTube demonstration with audio lasting less than three minutes.
- [ ] **[OWNER ACTION]** Confirm personal eligibility and the account-specific Devpost fields at
      submission time; only the entrant can make those attestations.
- [x] **[OWNER ACTION]** Change the repository to public only after the local and clean-clone gates
      pass. Verify it while logged out.
- [x] **[OWNER ACTION]** Authenticate the native browser/agent environment needed for the live
      WebMCP take. Use a dedicated demo profile where possible.
- [ ] **[OWNER ACTION]** Prepare the YouTube and Devpost accounts. Keep those account pages out of
      the product recording.
- [x] **[OWNER ACTION]** Decide whether Hyperframes or Remotion will assemble the final edit. Either
      is acceptable; the result must still show genuine native WebMCP interaction.

## 3. Privacy and capture safety

- [x] Use a clean desktop and browser profile. Hide the bookmarks bar, unrelated tabs, downloads,
      menu-bar account names, terminal history, and desktop files.
- [x] Enable Do Not Disturb and close chat, mail, calendar, password manager, clipboard manager,
      and cloud-sync notifications.
- [x] Never record GitHub, Cloudflare, OpenAI, Google, or Devpost tokens; `.env` files; cookies;
      request authorization headers; private repository settings; or browser sync identity.
- [x] Do not open raw IndexedDB records, the full `export_document` source, or private console
      history during the take. A tool name, bounded result summary, and sanitized receipt are
      sufficient.
- [x] Use only the seeded Koi Document and the fixed demo copy. Check the canvas and agent
      transcript for personal names, private URLs, or prior prompts before pressing Record.
- [x] Confirm the visible build label is correct without exposing local filesystem paths.
- [ ] Record a ten-second privacy test, inspect every edge of the frame, then discard it before the
      real take.

## 4. Audio and picture setup

- [x] Capture at `1920x1080`, `30` fps, with browser zoom at `100%`. Use a higher source
      resolution only if the final 1080p text remains sharper after downscaling.
- [x] Keep Koi's canvas dominant and the release-harness call feed large enough to read tool names.
      Avoid zooming raw JSON to full screen.
- [x] Record clean voice audio at `48 kHz`; remove hum and keyboard spikes without making the
      voice sound processed.
- [x] Target roughly `-16` to `-14 LUFS` integrated loudness and no peak above `-1 dBTP`, or verify
      equivalent clear, non-clipping speech by ear if loudness metering is unavailable.
- [ ] Rehearse the 2:48 shot list twice. The first genuine successful take is preferable to a
      transcript assembled from unrelated tool calls.
- [x] Leave enough cursor travel time for viewers to follow. The edit extends explanatory holds;
      it does not accelerate or rearrange the captured product interactions.

## 5. Required on-screen proof

- [x] Opening shows the public HTTPS URL, seeded canvas, **WebMCP ready**, browser-local challenge
      pill, and correct build identifier.
- [x] Discovery shows all eight exact Stage 1 tool names.
- [x] First agent loop visibly calls `get_canvas_context`, `list_components`,
      `inspect_elements`, and `create_elements`.
- [x] Canvas visibly gains `demo-review-card` and `demo-review-button`; the tool receipt reports
      `applied`.
- [x] An uncut reload restores both new Elements from IndexedDB.
- [x] The scripted human-input path edits `brief-note` and drags `demo-review-button` using real
      pointer and keyboard events.
- [x] Second agent loop calls `inspect_elements` again and visibly observes the newer direct-input
      state before `update_elements` and `arrange_elements` refine the result.
- [x] Architecture shot shows all three entry surfaces converging on the shared command/query core.
- [x] Closing frame shows the real public live and repository URLs.
- [x] No statement implies that `delete_elements` or `export_document` was executed if each was
      only shown in discovery.

## 6. Encode and verify the final file

- [x] Export a broadly compatible MP4: H.264/AVC video, `yuv420p` pixel format, AAC audio, 48 kHz,
      stereo or mono.
- [x] Target duration: `00:02:48`. Required duration: strictly less than `00:03:00`.
- [x] Fill the probe result below. If `ffprobe` is available, run:

```sh
ffprobe -v error \
  -show_entries format=duration,format_name:stream=index,codec_type,codec_name,pix_fmt,width,height,r_frame_rate,sample_rate,channels \
  -of json \
  [ABSOLUTE_VIDEO_PATH]
```

```text
Verified duration: 168.000000 seconds
Container: mov,mp4,m4a,3gp,3g2,mj2
Video: h264 (High), yuv420p (limited range, BT.709), 1920x1080, 30/1
Audio: aac, 48000 Hz, 2 channels
Checked by: Codex media probe
Checked at: 2026-09-03T14:14:36Z
```

- [ ] Watch the exported file from beginning to end with headphones. Confirm narration is present,
      synchronized, intelligible, and free of clipped words.
- [x] Pause on every tool-call shot and verify names, Element IDs, versions, URLs, and receipts are
      readable and accurate.
- [x] Decode all 5,040 frames successfully and inspect 21 representative frames at the opening,
      transitions, tool calls, persistence sequence, architecture shot, and closing. No sampled
      frame contains a blank, notification, cursor trail, accidental persistence cut, or Stage 2
      mockup presented as working behavior.
- [x] Record the final file's SHA-256 as
      `38f62d6386d4323cdbc45b60684de4ec617251cd93e93ae3a36ee73febcecab4` so later edits cannot be
      confused with the submitted artifact.

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
- [ ] Tag deployed application commit `c31366f3ae3a7a58af56b9e7f7933bda4491b694` as
      `webmcp-challenge-submission-2026` and push the tag.
- [ ] Record live URL, public repository URL, public YouTube URL, submission ID, deployed
      application SHA, public repository HEAD, deployment ID, and confirmation artifact path in
      `docs/evidence/challenge-submission.md`.
- [ ] Pin the Stage 1 challenge deployment until judging ends. Do not deploy Stage 2 breaking
      changes over the submitted URL.

## Final sign-off

```text
[ ] The public app, video, and Devpost entry identify the deployed application SHA; the public
    source contains that commit and separately identifies later evidence-only commits.
[ ] The live no-account path works from a clean profile.
[ ] The video is public, has audio, and is under 180 seconds.
[ ] Every WebMCP claim is visible or linked to public evidence.
[ ] Current limitations are stated plainly; no Stage 2 capability is presented as complete.
[ ] Submission confirmation and exact release identifiers are preserved.
```
