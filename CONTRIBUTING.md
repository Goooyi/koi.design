# Contributing to Koi

Thank you for helping improve Koi. Keep changes focused, preserve the contracts documented in
`CONTEXT.md` and `docs/adr/`, and run the relevant repository gates before opening a pull request.

## Developer Certificate of Origin

Koi uses Developer Certificate of Origin version 1.1 sign-off. Add a `Signed-off-by` trailer to
every commit with:

```sh
git commit --signoff
```

The sign-off certifies the following terms. Use your real name and an email address you are
authorized to use; pseudonymous sign-offs are not accepted for contributions.

### Developer Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I have the right to submit it under
the open source license indicated in the file; or

(b) The contribution is based upon previous work that, to the best of my knowledge, is covered
under an appropriate open source license and I have the right under that license to submit that
work with modifications, whether created in whole or in part by me, under the same open source
license (unless I am permitted to submit under a different license), as indicated in the file; or

(c) The contribution was provided directly to me by some other person who certified (a), (b), or
(c), and I have not modified it; and

(d) I understand and agree that this project and the contribution are public and that a record of
the contribution, including all personal information I submit with it, is maintained indefinitely
and may be redistributed consistent with this project or the open source license(s) involved.

## Contribution license

Unless a file states otherwise, contributions are licensed under
`AGPL-3.0-or-later`, the same license as Koi. Signing the DCO does not transfer copyright ownership
and is not a contributor license agreement.

## Pull requests

- Explain the observable outcome and any changed invariant.
- Add tests for realistic regressions, non-trivial boundaries, or concrete bugs.
- Do not update snapshots merely to hide a failure.
- Do not commit credentials, customer content, browser profiles, traces, or local Koi documents.
- Keep third-party provenance and license metadata with any new dependency or asset.

See `SECURITY.md` for private vulnerability reporting.
