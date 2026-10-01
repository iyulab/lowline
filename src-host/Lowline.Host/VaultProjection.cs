using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Formbase.Core.Query;
using Formbase.Core.Schema;

namespace Lowline.Host;

/// <summary>A field of a template, as the UI's Formdown parser reports it.</summary>
public sealed record TemplateField(string Name, string Type, bool Multiple = false);

/// <summary>
/// A template: its `id@version`, its fields in template order, and the judgment fields its author
/// turned suggestions on for (none unless named).
/// </summary>
public sealed record TemplateSnapshot(string Ref, IReadOnlyList<TemplateField> Fields, IReadOnlyList<string>? Suggest = null);

/// <summary>
/// A document: where it lives in the vault, its template, its recorded values, when it was last
/// saved (ms since the epoch — its values were last confirmed then), if known, and whether a sync
/// client left a conflict copy of it — until the person settles which to keep, its values are not
/// confirmed: it stays in the table, and suggestions do not learn from it. <see cref="Id"/> is what it is
/// known by — the id in its front matter, or its path when it has none — and what events name it by.
/// </summary>
public sealed record DocumentSnapshot(
    string Path, string Template, IReadOnlyDictionary<string, JsonElement> Values, long? Modified = null, bool Conflicted = false,
    string? Id = null)
{
    /// <summary>What suggestions learned and events recorded about the document are keyed by.</summary>
    public string Identity => Id ?? Path;
}

/// <summary>
/// What a person did with a suggestion (<c>accept</c>, <c>correct</c> or <c>reject</c>), read from the
/// vault's event files. <see cref="Doc"/> is the document's <see cref="DocumentSnapshot.Identity"/>, <see cref="Template"/> its
/// template (absent in events recorded before it was written down), <see cref="Source"/> where the suggestion came
/// from — <c>key</c> (a value settled alongside one the document has) or <c>memory</c> (a similar record, offered
/// before similar records stopped being suggested) — as the event file records it.
/// </summary>
public sealed record SuggestionEvent(
    string At, string Doc, string Field, string Kind, string Suggested, string? Template = null, string? Source = null);

/// <summary>
/// Everything the sidecar knows about a vault: what the shell read and the UI parsed — templates,
/// documents, and what people did with suggestions.
/// </summary>
public sealed record VaultSnapshot(
    IReadOnlyList<TemplateSnapshot> Templates,
    IReadOnlyList<DocumentSnapshot> Documents,
    IReadOnlyList<SuggestionEvent>? Events = null);

/// <summary>
/// What an ingest changed: documents appended because they are new or changed, records retired because
/// their document left the vault (or its template), the templates whose tables were rebuilt, and the
/// documents no table shows, and the fields left empty in a row because their value could not be read as
/// the field's type.
/// </summary>
public sealed record IngestResult(
    int Appended, int Retired, IReadOnlyList<string> Projections, IReadOnlyList<SkippedDocument> Skipped,
    IReadOnlyList<SkippedField> SkippedFields);

public sealed record SkippedDocument(string Path, string Reason);

/// <summary>A document's field whose value its row in <see cref="Template"/>'s table leaves empty, and why.</summary>
public sealed record SkippedField(string Template, string Path, string Field, string Reason);

public sealed record ProjectionColumn(string Name, string Type);

/// <summary>A template's documents as a table: one row per document, keyed by its vault path.</summary>
public sealed record ProjectionTable(string Template, IReadOnlyList<ProjectionColumn> Columns, IReadOnlyList<ProjectionRow> Rows);

public sealed record ProjectionRow(string Path, IReadOnlyDictionary<string, object?> Values);

/// <summary>
/// One condition on a template's table. <see cref="Column"/> is a field's name, or
/// <see cref="VaultProjection.PathColumn"/> for the document's vault path; <see cref="Op"/> is <c>contains</c>
/// (text, ignoring case), <c>equal</c>, or <c>atLeast</c> / <c>atMost</c> (a number or date field's bounds, both
/// included — a date as the field writes it, read as the same day on every computer).
/// </summary>
public sealed record ColumnFilter(string Column, string Op, string Value)
{
    /// <summary>The condition as Formbase asks it. An operator other than the two is a request no screen makes.</summary>
    public FieldFilter ToFieldFilter() => new(Column, Op switch
    {
        "contains" => FilterOperator.Contains,
        "equal" => FilterOperator.Equal,
        "atLeast" => FilterOperator.GreaterThanOrEqual,
        "atMost" => FilterOperator.LessThanOrEqual,
        _ => throw new ArgumentException("unknown filter operator", nameof(Op)),
    }, Value);
}

/// <summary>What the UI asks the text of the vault: documents holding these words, within one template if named.</summary>
public sealed record CaseQuery(string Query, string? Template = null, int? Max = null);

/// <summary>What the UI asks for the documents most like the one at <see cref="Path"/>.</summary>
public sealed record SimilarQuery(string Path, int? Max = null);

/// <summary>What the UI asks of a template's table: the rows that match every filter.</summary>
public sealed record ProjectionQuery(string Template, IReadOnlyList<ColumnFilter>? Filters = null);

/// <summary>
/// The vault projected through Formbase — tables in a cache outside the vault — and the suggestions and
/// correction curves learned from its confirmed values.
/// </summary>
/// <param name="cacheDirectory">
/// Where projection caches live, one file per vault. Without one they live in a temporary directory for as
/// long as this projection.
/// </param>
public sealed class VaultProjection(string? cacheDirectory = null, HostFailures? failures = null) : IAsyncDisposable
{
    /// <summary>The setting that names the cache directory.</summary>
    public const string CacheVariable = "LOWLINE_HOST_CACHE";

    /// <summary>The column that carries a document's vault path. `$` cannot start a Formdown field name.</summary>
    public const string PathColumn = "$path";

    private const int DefaultMax = 20;

    private readonly SemaphoreSlim _gate = new(1, 1);
    /// <summary>Held while the text index changes; a search waits for the sync in progress.</summary>
    private readonly SemaphoreSlim _casesGate = new(1, 1);
    private CaseIndex? _cases;
    /// <summary>The documents of the latest snapshot by what they are known as, and by path.</summary>
    private Dictionary<string, DocumentSnapshot> _byIdentity = new(StringComparer.Ordinal);
    private Dictionary<string, DocumentSnapshot> _byPath = new(StringComparer.Ordinal);
    private readonly bool _ownsDirectory = string.IsNullOrEmpty(cacheDirectory);
    private ProjectionCache? _cache;
    private string? _vault;
    private Dictionary<string, TemplateSnapshot>? _templates;
    private Suggestions? _suggestions;
    private CancellationTokenSource? _selecting;
    private IReadOnlyList<FieldCurve> _curves = [];

    /// <summary>The directory the caches live in.</summary>
    public string CacheDirectory { get; } = string.IsNullOrEmpty(cacheDirectory)
        ? Path.Combine(Path.GetTempPath(), $"lowline-projection-{Guid.NewGuid():N}")
        : cacheDirectory;

    /// <summary>
    /// The cache file of the vault at <paramref name="vault"/> (its root, as the shell names it): named by a
    /// hash of the root, so moving a vault starts a new cache and nothing of the path shows in the name.
    /// </summary>
    public string CacheFileOf(string vault) => Path.Combine(CacheDirectory,
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(vault.Normalize(NormalizationForm.FormC))))[..32].ToLowerInvariant() + ".db");

    public bool Indexed => _templates is not null;

    /// <summary>Whether suggestions have been built from the vault's confirmed values.</summary>
    public bool MemoryReady => _suggestions is not null;

    /// <summary>
    /// The threshold selection the latest ingest started, if it needed one; completes when its result is
    /// in use (or it was superseded by a later ingest).
    /// </summary>
    public Task ThresholdsSelected { get; private set; } = Task.CompletedTask;

    /// <summary>
    /// The text-index sync the latest ingest started: completes, with how many documents it indexed, when the index
    /// holds that snapshot.
    /// </summary>
    public Task<int> CasesIndexed { get; private set; } = Task.FromResult(0);

    /// <summary>The chosen thresholds of the vault at <paramref name="vault"/>, beside its projection cache.</summary>
    public string ThresholdsFileOf(string vault) => Path.ChangeExtension(CacheFileOf(vault), ".thresholds.json");

    /// <summary>The text index file of the vault at <paramref name="vault"/>, beside its projection cache.</summary>
    public string CasesFileOf(string vault) => Path.ChangeExtension(CacheFileOf(vault), ".cases.db");

    /// <summary>Brings the projection, suggestions and curves up to this snapshot of an unnamed vault.</summary>
    public Task<IngestResult> IngestAsync(VaultSnapshot vault, CancellationToken cancellationToken) =>
        IngestAsync(vault, "", cancellationToken);

    /// <summary>
    /// Brings the projection, suggestions and curves up to this snapshot of the vault at <paramref name="root"/>.
    /// Another vault than the last one switches to that vault's cache.
    /// </summary>
    public async Task<IngestResult> IngestAsync(VaultSnapshot vault, string root, CancellationToken cancellationToken)
    {
        // The thresholds this vault's fields last had: from the suggestions in use when it is the vault already open,
        // else as an earlier launch kept them — never another vault's, whose fields may share a template's name.
        var kept = _vault == root && _suggestions is { } current ? current.Thresholds : ThresholdStore.Load(ThresholdsFileOf(root));
        var suggestions = await Suggestions.BuildAsync(vault, cancellationToken, kept);
        var curves = Curves.Compute(vault);
        await _gate.WaitAsync(cancellationToken);
        try
        {
            if (_cache is not null && _vault != root)
            {
                await _cache.DisposeAsync();
                _cache = null;
                await CloseCasesAsync();
            }
            if (_cache is null)
            {
                Directory.CreateDirectory(CacheDirectory);
                _cache = await ProjectionCache.OpenAsync(CacheFileOf(root), cancellationToken);
                _cases = CaseIndex.Open(CasesFileOf(root));
                _vault = root;
            }
            var result = await _cache.IngestAsync(vault, cancellationToken);
            _templates = vault.Templates.ToDictionary(t => t.Ref, StringComparer.Ordinal);
            _byIdentity = vault.Documents.GroupBy(d => d.Identity, StringComparer.Ordinal).ToDictionary(g => g.Key, g => g.First(), StringComparer.Ordinal);
            _byPath = vault.Documents.ToDictionary(d => d.Path, StringComparer.Ordinal);
            CasesIndexed = SyncCasesAsync(_cases!, vault);
            _suggestions = suggestions;
            _curves = curves;
            _selecting?.Cancel();
            _selecting = null;
            if (suggestions.NeedsSelection)
            {
                _selecting = new CancellationTokenSource();
                ThresholdsSelected = SelectThresholdsAsync(suggestions, root, _selecting.Token);
            }
            return result;
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>
    /// Chooses thresholds away from the request that ingested the vault — the replay takes seconds on a large
    /// vault — and uses them if no later ingest has replaced these suggestions meanwhile.
    /// </summary>
    private async Task SelectThresholdsAsync(Suggestions suggestions, string root, CancellationToken cancellationToken)
    {
        try
        {
            var chosen = await Task.Run(() => suggestions.SelectThresholds(cancellationToken), cancellationToken);
            await _gate.WaitAsync(cancellationToken);
            try
            {
                if (ReferenceEquals(_suggestions, suggestions))
                {
                    suggestions.Apply(chosen);
                    ThresholdStore.Save(ThresholdsFileOf(root), suggestions.Thresholds);
                }
            }
            finally
            {
                _gate.Release();
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // superseded by a later ingest
        }
        catch (Exception e)
        {
            // No request is waiting on this: the shell takes the failure the next time it asks.
            failures?.Record(e);
        }
    }

    /// <summary>
    /// Indexes the vault's text away from the request that ingested it — the first index of a large vault takes
    /// seconds — one sync at a time, in the order the ingests came.
    /// </summary>
    private async Task<int> SyncCasesAsync(CaseIndex cases, VaultSnapshot vault)
    {
        await _casesGate.WaitAsync();
        try
        {
            // An index closed meanwhile belongs to a vault no longer open.
            return ReferenceEquals(cases, _cases) ? await Task.Run(() => cases.SyncAsync(vault, CancellationToken.None)) : 0;
        }
        catch (Exception e)
        {
            // No request is waiting on this: the shell takes the failure the next time it asks.
            failures?.Record(e);
            return 0;
        }
        finally
        {
            _casesGate.Release();
        }
    }

    private async Task CloseCasesAsync()
    {
        await _casesGate.WaitAsync();
        try
        {
            if (_cases is not null) await _cases.DisposeAsync();
            _cases = null;
        }
        finally
        {
            _casesGate.Release();
        }
    }

    /// <summary>
    /// The documents whose values hold the words asked for, best first, one per document — within one template if
    /// one is named. Waits for the text index to hold the latest ingest.
    /// </summary>
    public async Task<IReadOnlyList<CaseHit>> SearchAsync(CaseQuery query, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(query.Query)) return [];
        await CasesIndexed.WaitAsync(cancellationToken);
        await _casesGate.WaitAsync(cancellationToken);
        try
        {
            if (_cases is null) return [];
            var found = await _cases.SearchAsync(query.Query, query.Template, query.Max ?? DefaultMax, cancellationToken);
            return Hits(found);
        }
        finally
        {
            _casesGate.Release();
        }
    }

    /// <summary>
    /// The documents of the same template most like the one at a path, best first — itself and conflicted documents
    /// left out — or none when the vault has no document there.
    /// </summary>
    public async Task<IReadOnlyList<CaseHit>> SimilarAsync(SimilarQuery query, CancellationToken cancellationToken)
    {
        await CasesIndexed.WaitAsync(cancellationToken);
        await _casesGate.WaitAsync(cancellationToken);
        try
        {
            if (_cases is null || !_byPath.TryGetValue(query.Path, out var document)) return [];
            var found = await _cases.SimilarAsync(document.Identity, document.Template, query.Max ?? DefaultMax, cancellationToken);
            return Hits(found);
        }
        finally
        {
            _casesGate.Release();
        }
    }

    /// <summary>What the index found, as documents of the latest snapshot; one gone since is left out.</summary>
    private List<CaseHit> Hits(IEnumerable<(string Identity, string Text, double Score)> found) =>
        [.. found.SelectMany(f => _byIdentity.TryGetValue(f.Identity, out var d)
            ? [new CaseHit(d.Path, d.Template, f.Text, d.Conflicted, f.Score)]
            : Array.Empty<CaseHit>())];

    /// <summary>The table for one template, or null when the vault has no such template.</summary>
    public Task<ProjectionTable?> TableAsync(string template, CancellationToken cancellationToken) =>
        TableAsync(template, [], cancellationToken);

    /// <summary>
    /// The rows of one template's table that match every filter — Formbase answers them from the projection —
    /// or null when the vault has no such template.
    /// </summary>
    public async Task<ProjectionTable?> TableAsync(string template, IReadOnlyList<ColumnFilter> filters, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            return _cache is not null && _templates?.TryGetValue(template, out var snapshot) == true
                ? await _cache.TableAsync(snapshot, [.. filters.Select(f => f.ToFieldFilter())], cancellationToken)
                : null;
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>
    /// The correction curve of every judgment field — empty until a suggestion for it is decided — with how its
    /// saved documents did on replay once its threshold has been chosen, and why not until then.
    /// </summary>
    public async Task<IReadOnlyList<FieldCurve>> CurvesAsync(CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            return [.. _curves.Select(c => _suggestions?.Choice(c.Template, c.Field) is { } choice
                ? c with { Replay = new FieldReplay(choice.Threshold, choice.Precision, choice.AnswerRate, choice.Answered, choice.Lookups) }
                : c with
                {
                    WhyNoReplay = _suggestions?.WhyNoReplay(c.Template, c.Field) ?? NoReplay.Pending,
                    Closest = _suggestions?.Closest(c.Template, c.Field) is { } closest
                        ? new FieldShortfall(closest.Precision, closest.AnswerRate, closest.Answered, closest.Lookups, Suggestions.TargetPrecision)
                        : null,
                })];
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>A suggestion for a judgment field, or null when the template has no such judgment field.</summary>
    public async Task<Suggestion?> SuggestAsync(SuggestRequest request, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            return _suggestions is null ? null : await _suggestions.SuggestAsync(request, cancellationToken);
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>The Formbase column type for a Formdown field.</summary>
    public static ColumnType ColumnTypeOf(TemplateField field) => field.Type switch
    {
        "checkbox" when field.Multiple => ColumnType.Jsonb,
        "checkbox" => ColumnType.Boolean,
        "number" or "range" => ColumnType.Decimal,
        // A date, or a date and time, without a zone: Formbase reads both as UTC, so a day is the same
        // day on every computer, and ranges compare dates rather than text.
        "date" or "datetime-local" => ColumnType.Timestamp,
        _ => ColumnType.Text,
    };

    public async ValueTask DisposeAsync()
    {
        _selecting?.Cancel();
        if (_cache is not null) await _cache.DisposeAsync();
        await CloseCasesAsync();
        if (_ownsDirectory && Directory.Exists(CacheDirectory)) Directory.Delete(CacheDirectory, recursive: true);
    }
}

