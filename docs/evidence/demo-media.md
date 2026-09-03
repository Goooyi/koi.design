# Stage 1 demo media certification

Certified: `2026-09-03T14:14:36Z` (`2026-09-03 22:14:36 +08`)

## Final delivery

| Field                 | Certified value                                                    |
| --------------------- | ------------------------------------------------------------------ |
| File                  | `koi-design-webmcp-challenge.mp4`                                  |
| SHA-256               | `38f62d6386d4323cdbc45b60684de4ec617251cd93e93ae3a36ee73febcecab4` |
| Bytes                 | `21,510,866`                                                       |
| Container             | ISO Base Media / MP4                                               |
| Duration              | `168.000000` seconds (`2:48.000`)                                  |
| Video                 | H.264 High, 1920×1080, 30 fps, `yuv420p`, limited-range BT.709     |
| Video frames          | `5,040` decoded frames; expected `5,040`                           |
| Audio                 | AAC, 48 kHz, stereo                                                |
| Measured audio        | `-16.03` LUFS integrated, `-4.37` dBTP peak, `4.80` LU LRA         |
| Application commit    | `c31366f3ae3a7a58af56b9e7f7933bda4491b694`                         |
| Cloudflare deployment | `78efad47-5d7f-4b20-9b15-a9048dfdb2cb`                             |

The final media probe, full-frame decode count, and loudness scan all passed. Twenty-one frames extracted
from the encoded delivery—covering the opening, tool discovery, first semantic reads, applied
creation, reload restoration, scripted human-input path, fresh-version refinement, architecture,
closing, and final half-second—were visually inspected with no blank frame, accidental
notification, missing overlay, or unsupported product claim in those samples.

## Evidence chain

The final edit derives from the production capture certified in
[`native-webmcp-live.md`](native-webmcp-live.md):

- raw capture SHA-256:
  `e5e23e53793f36f43fa25fbc0ec2fbf99509d910e6c117b2667ff7ed7ec1fd74`;
- machine receipt SHA-256:
  `a2a277d4c9ff38b50b7fa3dbcef124d79b7bec81436381a1531863322b95adea`;
- final MP4 SHA-256:
  `38f62d6386d4323cdbc45b60684de4ec617251cd93e93ae3a36ee73febcecab4`.

Every source-video range used in the edit plays at 1× and may hold its final decoded frame while
the narration completes the chapter; no tool execution is accelerated, reordered, or synthesized.
The call feed is derived from the actual native responses. Persistent on-screen disclosures and
the narration identify both the native caller and the scripted human-input path as deterministic
release-harness actions, not live human input, model deliberation, or ChatGPT's Site Tools chrome.

The final MP4, raw WebMCP capture, and machine receipt are preserved under the repository-local,
gitignored `release-artifacts/stage1/` directory. Public YouTube publication and signed-out playback
verification remain account-bound submission steps; the eventual watch URL is intentionally not
invented here.
