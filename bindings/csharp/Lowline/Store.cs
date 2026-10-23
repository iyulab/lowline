using System.Collections.Concurrent;

namespace Lowline;

/// <summary>Which records learn together: one form, within one memory space — a workplace, a team, whatever the host
/// keeps apart. Records of one space never answer for another.</summary>
public readonly record struct LowlineScope(string Form, string Space);

/// <summary>Where a host keeps what the engine hands back: the settled records and the chosen tuning, by scope. The
/// engine itself stores nothing.</summary>
public interface ILowlineStore
{
    /// <summary>The scope's settled records, in settlement order.</summary>
    Task<IReadOnlyList<SettledRecord>> ReadRecordsAsync(LowlineScope scope, CancellationToken cancellationToken = default);

    /// <summary>Keeps a settled record, replacing the scope's record of the same id.</summary>
    Task AddRecordAsync(LowlineScope scope, SettledRecord record, CancellationToken cancellationToken = default);

    /// <summary>The scope's tuning, or <c>null</c> when none was kept.</summary>
    Task<string?> ReadTuningAsync(LowlineScope scope, CancellationToken cancellationToken = default);

    /// <summary>Keeps the scope's tuning, replacing the one before.</summary>
    Task WriteTuningAsync(LowlineScope scope, string tuning, CancellationToken cancellationToken = default);

    /// <summary>Removes the scope's records settled before <paramref name="before"/> — a retention period — and gives
    /// the ids of those that went.</summary>
    Task<IReadOnlyList<string>> ForgetBeforeAsync(
        LowlineScope scope, DateTimeOffset before, CancellationToken cancellationToken = default);

    /// <summary>Removes the scope's record of id <paramref name="id"/>, if it holds one.</summary>
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
            IReadOnlyList<SettledRecord> ordered = [.. kept.Records.Values.OrderBy(r => r.SettledAt)];
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
            kept.Records[record.Id] = record;
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
            var old = kept.Records.Values.Where(r => r.SettledAt < before).Select(r => r.Id).ToList();
            foreach (var id in old)
            {
                kept.Records.Remove(id);
            }

            return Task.FromResult<IReadOnlyList<string>>(old);
        }
    }

    /// <inheritdoc/>
    public Task<bool> ForgetAsync(LowlineScope scope, string id, CancellationToken cancellationToken = default)
    {
        var kept = Of(scope);
        lock (kept)
        {
            return Task.FromResult(kept.Records.Remove(id));
        }
    }

    private sealed class Kept
    {
        public Dictionary<string, SettledRecord> Records { get; } = [];

        public string? Tuning { get; set; }
    }
}
