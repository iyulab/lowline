# Lowline for .NET

The .NET host of the Lowline engine. On NuGet, `Lowline` carries the native library for Windows, Linux and macOS (x64
and arm64); a build in this repository binds the one cargo builds here (`cargo build -p lowline-ffi`).

| Project | What it does |
|---|---|
| `Lowline` | `LowlineEngine` — one form's engine over the native library: `Learn` stored records, `Restore` a stored tuning, `Propose` what to show, `Settle` a save (giving back the record to store), `Choose` and `Tune` thresholds, `Describe` and `Fill` for filling from a model, `Offer` for a model's judgement of a field the records could not answer. `ProposeField` for one field while a person types into it (only values that begin with the text, held to the threshold for that many characters). `Record` for a record settled elsewhere — the line to store, nothing learned — when a host builds the store from records it keeps itself. `Report` for how each decided field's replays went (the thresholds chosen and what the replay saw at them), kept with the tuning. `ILowlineStore` — where a host keeps records and tunings by `LowlineScope` (a form within a memory space), with forgetting by date or id. `LowlineForms` — the engines of a host's forms over its store: started from storage when first asked, saves stored and learned, thresholds chosen again in the background when they no longer stand. `ILowlineModel` — the host's model, filling from what a person wrote and, when it implements `JudgeAsync`, judging what the records could not answer (`LowlineForms.JudgeAsync`). |
| `Lowline.Sqlite` | `SqliteLowlineStore` and `UseSqlite`: two tables of its own (`lowline_records`, `lowline_tunings`), made on first use. |
| `Lowline.AspNetCore` | `AddLowline` and `MapLowline`: `POST {form}/propose`, `settle`, and `fill` and `judge` when a model is given. The host decides each request's memory space (`Space`) and allowed choices (`Allowed`), and — when it stores its records through its own API — gives `Saved` to have `settle` learn the record as it stored it rather than the values the request carries. |

```sh
cargo build -p lowline-ffi
dotnet test --solution Lowline.slnx
```
