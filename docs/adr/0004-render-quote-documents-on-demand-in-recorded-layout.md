# Render Quote Documents on demand in the recorded Quote Layout

Artisans download a Published Revision's Quote Document long after Publication, and we plan to offer several Quote Layouts. We do not store generated PDFs. Easy Quote creates each Quote Document when the Artisan downloads it, from the frozen content of the Published Revision. It uses the Quote Layout version recorded on that revision at Publication. The Quote Layout is chosen per Quote in the Working Draft, with a business default, and freezes at Publication like other customer-facing content. Revisions published before Quote Layouts existed use standard layout v1.

Deliberate design changes create a new Quote Layout version. Earlier versions stay available so older revisions keep their appearance. Fixes that restore what a version was always meant to show, such as clipped text or broken page breaks, go into that version and apply to its older revisions too. We promise the same layout, not identical PDF bytes: font or rendering-library upgrades may shift output slightly.

## Considered options

- **Store each generated PDF.** This gives exact reproduction, but it needs file storage, backups and a way to handle failed saves. The size is small, but the setup is not something we want in the first release.
- **Always render with the current layout.** This is the simplest option, and ADR 0003 allows it. However, changing a layout would then change how every earlier revision looks, which conflicts with offering several layouts.
