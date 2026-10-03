# Suggestions and learning

## What is suggested, and from what

Fill in the observed fields and a judgment field gets a suggested value when the values filled in settle it: the sidecar remembers the values people saved together (Gil, no model). Each value filled in lends strength to the values saved alongside it, and values filled in that agree add up; a judgment field whose strongest value is strong enough — where replaying its saved documents shows that strength gets it right often enough — is suggested that value. The suggestion says which filled-in value it rests on most. A choice field is suggested only a choice it offers now: a value confirmed under a choice since removed from the template stays in its documents but is not suggested, and is again if the choice comes back. When the values filled in settle nothing, it suggests nothing, and says so.

A suggestion is drawn by its field: the value to take — shown in an empty text field in place of its placeholder — what it rests on, and a way to decline it. A suggestion is not a value until the person takes it; taking it and saving is a confirmation, and only confirmations are learned from.

Similar documents are not suggested from. On a field judged from its observed values alone, the value a similar document confirmed is right well below the precision its replay promises, and no threshold fixes that: documents that read alike are often judged differently. Every suggestion drawn promises the same thing, so only values that keep that promise are drawn. The documents most like a saved one are still there to look at, under "비슷한 사례" on its page, when the person opens it — each with the value it confirmed in each judgment field, as the vault holds it.

## How often is often enough

The strength a field's values saved together need is chosen per field by replaying its saved documents in the order they were saved: the lowest strength down to which the replayed suggestions were right 80% of the time, in every band and not only taken together. It is chosen once a field has enough saved documents, and again as they grow by a tenth or as its choices change; until then nothing is suggested for the field. The chosen strengths are kept on this device beside the vault's cache, so a later launch uses them at once rather than replaying again — except the first launch after an update of what measures it (Gil), which replays once more, since an update may measure strength on another scale.

A judgment field left without a suggestion says why beside it: nothing confirmed yet; its history has not yet shown that the values saved together are right often enough (with how many confirmed documents it had to learn from); the values filled in settle nothing; or suggestions are not available right now, while typing and saving go on.

## The record of what happened

When a document is saved, what happened to each suggestion — accepted, corrected or rejected — is appended to `.lowline/events/<device>.jsonl` in the vault, one file per install, with the template's version, the fields already filled when it was made (names only, in the order they were filled) and when it was shown and taken or rejected. Suggestions read these files back: a field whose suggestion was last rejected in a document is not suggested in that document again, even after it is reopened.

An event records the template version it was made under; it counts for the template of that id as the template is now.

## The learning view

For each judgment field, the learning view shows how often recent suggestions were taken as offered — counted over the fields that got a suggestion, decision by decision, from the event files — so whether suggestions improve with use is something to look at, not to assume. Until ten have been decided it gives the count right, not a share. The decisions are also counted apart by where each suggestion came from — a value settled alongside one the document has, or, in decisions made before similar records stopped being suggested, a similar record; that line says no new suggestions come from similar records.

Because that count leaves out the fields that got no suggestion, a field whose strength has been chosen also shows how its saved documents did on replay: how often one was suggested at all, and how often it was right. A field whose replay never reached the target shows how close it came: how often its answers were right at the most precise strength that still gathered enough of them. When that reaches the target taken together but a band within it falls short, it says so rather than calling the field short of the target.

Beneath the curves, weekly counts of those decisions and of the suggestions this device showed — by week, form and judgment field, and by where each suggestion came from, with forms and fields numbered and nothing else — can be copied to hand to someone studying the curves. Which number is which is shown beside them and never copied.
