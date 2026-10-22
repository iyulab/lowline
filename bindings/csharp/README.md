# Lowline for .NET

The .NET host of the Lowline engine. Not packed yet: a local build binds the native library cargo builds in this
repository (`cargo build -p lowline-ffi`).

| Project | What it does |
|---|---|
| `Lowline` | `LowlineEngine` — one form's engine over the native library: `Learn` stored records, `Restore` a stored tuning, `Propose` what to show, `Settle` a save (giving back the record to store), `Choose` and `Tune` thresholds, `Describe` and `Fill` for filling from a model. `ILowlineStore` — where a host keeps records and tunings by `LowlineScope` (a form within a memory space), with forgetting by date or id. `LowlineForms` — the engines of a host's forms over its store: started from storage when first asked, saves stored and learned, thresholds chosen again in the background when they no longer stand. `ILowlineModel` — the host's model, for filling. |
| `Lowline.Sqlite` | `SqliteLowlineStore` and `UseSqlite`: two tables of its own (`lowline_records`, `lowline_tunings`), made on first use. |
| `Lowline.AspNetCore` | `AddLowline` and `MapLowline`: `POST {form}/propose`, `settle`, and `fill` when a model is given. The host decides each request's memory space (`Space`) and allowed choices (`Allowed`). |

```sh
cargo build -p lowline-ffi
dotnet test --solution Lowline.slnx
```
