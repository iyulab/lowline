using System.Collections.Concurrent;

namespace Lowline;

/// <summary>Which records learn together: one form, within one memory space — a workplace, a team, whatever the host
/// keeps apart. Records of one space never answer for another.</summary>
public readonly record struct LowlineScope(string Form, string Space);

/// <summary>Where a host keeps what the engine hands back: the settled records and the chosen tuning, by scope. The
/// engine itself stores nothing.</summary>
public interface ILowlineStore
{
    /// <summary>The scope's settled records, in settlement order — every line kept, a record settled more than once
    /// giving one line for each time.</summary>
    Task<IReadOnlyList<SettledRecord>> ReadRecordsAsync(LowlineScope scope, CancellationToken cancellationToken = default);

    /// <summary>Keeps a settled record's line beside the lines kept before. A record settled again — reopened and saved,
    /// or audited by a second person — keeps its earlier lines too: the engine learns each record from its latest line,
    /// and counts a later check as an audit of the decision first settled, which the earlier line is.</summary>
    Task AddRecordAsync(LowlineScope scope, SettledRecord record, CancellationToken cancellationToken = default);

    /// <summary>The scope's tuning, or <c>null</c> when none was kept.</summary>
    Task<string?> ReadTuningAsync(LowlineScope scope, CancellationToken cancellationToken = default);

    /// <summary>Keeps the scope's tuning, replacing the one before.</summary>
    Task WriteTuningAsync(LowlineScope scope, string tuning, CancellationToken cancellationToken = default);

    /// <summary>Removes the scope's records last settled before <paramref name="before"/> — a retention period — with
    /// every line each kept, and gives the ids of those that went. A record settled again since keeps all its lines.
    /// </summary>
    Task<IReadOnlyList<string>> ForgetBeforeAsync(
        LowlineScope scope, DateTimeOffset before, CancellationToken cancellationToken = default);

    /// <summary>Removes the scope's record of id <paramref name="id"/> — every line of it — if it holds one.</summary>
    Task<bool> ForgetAsync(LowlineScope scope, string id, CancellationToken cancellationToken = default);
}

/// <summary>An <see cref="ILowlineStore"/> held in memory — for tests, and for a host that learns afresh each run.
/// </summary>
public sealed class InMemoryLowlineStore : ILowlineStore
{
    private readonly ConcurrentDictionary<LowlineScope, Kept> _scopes = new();

    private Kept Of(LowlineScope scope) => _scopes.GetOrAdd(scope, _ => new Kept());

    /// <inheritdoc/>
    public Task<IReadOnlyList<SettledRecord>> ReadRecordsAsync(
        LowlineScope scope, CancellationToken cancellationToken = default)
    {
        var kept = Of(scope);
        lock (kept)
        {
            IReadOnlyList<SettledRecord> ordered = [.. kept.Records.OrderBy(r => r.SettledAt)];
            return Task.FromResult(ordered);
        }
    }

    /// <inheritdoc/>
    public Task AddRecordAsync(LowlineScope scope, SettledRecord record, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(record);
        var kept = Of(scope);
        lock (kept)
        {
            kept.Records.Add(record);
        }

        return Task.CompletedTask;
    }

    /// <inheritdoc/>
    public Task<string?> ReadTuningAsync(LowlineScope scope, CancellationToken cancellationToken = default)
    {
        var kept = Of(scope);
        lock (kept)
        {
            return Task.FromResult(kept.Tuning);
        }
    }

    /// <inheritdoc/>
    public Task WriteTuningAsync(LowlineScope scope, string tuning, CancellationToken cancellationToken = default)
    {
        var kept = Of(scope);
        lock (kept)
        {
            kept.Tuning = tuning;
        }

        return Task.CompletedTask;
    }

    /// <inheritdoc/>
    public Task<IReadOnlyList<string>> ForgetBeforeAsync(
        LowlineScope scope, DateTimeOffset before, CancellationToken cancellationToken = default)
    {
        var kept = Of(scope);
        lock (kept)
        {
            var old = kept.Records
                .GroupBy(r => r.Id)
                .Where(lines => lines.Max(r => r.SettledAt) < before)
                .Select(lines => lines.Key)
                .ToHashSet();
            kept.Records.RemoveAll(r => old.Contains(r.Id));
            return Task.FromResult<IReadOnlyList<string>>([.. old]);
        }
    }

    /// <inheritdoc/>
    public Task<bool> ForgetAsync(LowlineScope scope, string id, CancellationToken cancellationToken = default)
    {
        var kept = Of(scope);
        lock (kept)
        {
            return Task.FromResult(kept.Records.RemoveAll(r => r.Id == id) > 0);
        }
    }

    private sealed class Kept
    {
        public List<SettledRecord> Records { get; } = [];

        public string? Tuning { get; set; }
    }
}
