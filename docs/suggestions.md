# Suggestions and learning

## What is suggested, and from what

Fill in the observed fields and the judgment fields get a suggested value. The sidecar remembers the values people saved in judgment fields, so a similar document gets the same value suggested (Gil's character-level memory, no model). When nothing saved is close enough, it suggests nothing, and says so.

A suggestion is drawn by its field: the value to take — shown in an empty text field in place of its placeholder — what it rests on, and a way to decline it. It rests on either of two things:

- **Similar records** — the confirmed documents most like this one, up to three, each with the value it confirmed. Only documents as close as the field's threshold asks are shown, the same bar the value offered passed. The value offered is still one.
- **Values saved together** — a field that another field decides, where replaying its saved documents shows the other field's value alone gets it right often enough, is suggested from the values saved alongside that value, and the suggestion says which value it rests on.

Where saved documents disagree on the same request, the latest save wins. A suggestion is not a value until the person takes it; taking it and saving is a confirmation, and only confirmations are learned from.

## How close is close enough

The threshold is chosen per field by replaying its saved documents in the order they were saved: the lowest similarity down to which the replayed suggestions were right 80% of the time at every similarity, not only taken together, so many close matches cannot carry a band of poor ones. It is chosen once a field has enough saved documents, and again as they grow by a tenth; until then a fixed similarity serves.

A judgment field left without a suggestion says why beside it: nothing confirmed yet; nothing confirmed is close enough (with how many confirmed documents it had to learn from); replaying its history never reached the target, so it suggests nothing from similar records yet; or suggestions are not available right now, while typing and saving go on.

## The record of what happened

When a document is saved, what happened to each suggestion — accepted, corrected or rejected — is appended to `.lowline/events/<device>.jsonl` in the vault, one file per install, with the template's version, the fields already filled when it was made (names only, in the order they were filled) and when it was shown and taken or rejected. Suggestions read these files back: a field whose suggestion was last rejected in a document is not suggested in that document again, even after it is reopened.

An event records the template version it was made under; it counts for the template of that id as the template is now.

## The learning view

For each judgment field, the learning view shows how often recent suggestions were taken as offered — counted over the fields that got a suggestion, decision by decision, from the event files — so whether suggestions improve with use is something to look at, not to assume. Until ten have been decided it gives the count right, not a share.

Because that count leaves out the fields that got no suggestion, a field whose threshold has been chosen also shows how its saved documents did on replay: how often one was suggested at all, and how often it was right. A field whose replay never reached the target shows how close it came: how often its answers were right at the most precise similarity that still gathered enough of them. When that reaches the target taken together but a band within it falls short, it says so rather than calling the field short of the target.

Beneath the curves, weekly counts of those decisions and of the suggestions this device showed — by week, form and judgment field, with forms and fields numbered and nothing else — can be copied to hand to someone studying the curves. Which number is which is shown beside them and never copied.
