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
/// template (absent in events recorded before it was written down).
/// </summary>
public sealed record SuggestionEvent(string At, string Doc, string Field, string Kind, string Suggested, string? Template = null);

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
/// documents no table shows.
/// </summary>
public sealed record IngestResult(int Appended, int Retired, IReadOnlyList<string> Projections, IReadOnlyList<SkippedDocument> Skipped);

public sealed record SkippedDocument(string Path, string Reason);

public sealed record ProjectionColumn(string Name, string Type);

/// <summary>A template's documents as a table: one row per document, keyed by its vault path.</summary>
public sealed record ProjectionTable(string Template, IReadOnlyList<ProjectionColumn> Columns, IReadOnlyList<ProjectionRow> Rows);

public sealed record ProjectionRow(string Path, IReadOnlyDictionary<string, object?> Values);

/// <summary>
/// One condition on a template's table. <see cref="Column"/> is a field's name, or
/// <see cref="VaultProjection.PathColumn"/> for the document's vault path; <see cref="Op"/> is <c>contains</c>
/// (text, ignoring case) or <c>equal</c>.
/// </summary>
public sealed record ColumnFilter(string Column, string Op, string Value)
{
    /// <summary>The condition as Formbase asks it. An operator other than the two is a request no screen makes.</summary>
    public FieldFilter ToFieldFilter() => new(Column, Op switch
    {
        "contains" => FilterOperator.Contains,
        "equal" => FilterOperator.Equal,
        _ => throw new ArgumentException("unknown filter operator", nameof(Op)),
    }, Value);
}

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

    private readonly SemaphoreSlim _gate = new(1, 1);
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

    /// <summary>Brings the projection, suggestions and curves up to this snapshot of an unnamed vault.</summary>
    public Task<IngestResult> IngestAsync(VaultSnapshot vault, CancellationToken cancellationToken) =>
        IngestAsync(vault, "", cancellationToken);

    /// <summary>
    /// Brings the projection, suggestions and curves up to this snapshot of the vault at <paramref name="root"/>.
    /// Another vault than the last one switches to that vault's cache.
    /// </summary>
    public async Task<IngestResult> IngestAsync(VaultSnapshot vault, string root, CancellationToken cancellationToken)
    {
        var suggestions = await Suggestions.BuildAsync(vault, cancellationToken, _suggestions);
        var curves = Curves.Compute(vault);
        await _gate.WaitAsync(cancellationToken);
        try
        {
            if (_cache is not null && _vault != root)
            {
                await _cache.DisposeAsync();
                _cache = null;
            }
            if (_cache is null)
            {
                Directory.CreateDirectory(CacheDirectory);
                _cache = await ProjectionCache.OpenAsync(CacheFileOf(root), cancellationToken);
                _vault = root;
            }
            var result = await _cache.IngestAsync(vault, cancellationToken);
            _templates = vault.Templates.ToDictionary(t => t.Ref, StringComparer.Ordinal);
            _suggestions = suggestions;
            _curves = curves;
            _selecting?.Cancel();
            _selecting = null;
            if (suggestions.NeedsSelection)
            {
                _selecting = new CancellationTokenSource();
                ThresholdsSelected = SelectThresholdsAsync(suggestions, _selecting.Token);
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
    private async Task SelectThresholdsAsync(Suggestions suggestions, CancellationToken cancellationToken)
    {
        try
        {
            var chosen = await Task.Run(() => suggestions.SelectThresholdsAsync(cancellationToken), cancellationToken);
            await _gate.WaitAsync(cancellationToken);
            try
            {
                if (ReferenceEquals(_suggestions, suggestions)) suggestions.Apply(chosen);
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
                : c with { WhyNoReplay = _suggestions?.WhyNoReplay(c.Template, c.Field) ?? NoReplay.Pending })];
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
        _ => ColumnType.Text,
    };

    public async ValueTask DisposeAsync()
    {
        _selecting?.Cancel();
        if (_cache is not null) await _cache.DisposeAsync();
        if (_ownsDirectory && Directory.Exists(CacheDirectory)) Directory.Delete(CacheDirectory, recursive: true);
    }
}

