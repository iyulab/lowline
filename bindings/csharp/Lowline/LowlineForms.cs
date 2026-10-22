using System.Collections.Concurrent;
using System.Text.Json.Nodes;

namespace Lowline;

/// <summary>The engines of a host's forms over its store: one engine per form and memory space, started from the
/// stored records and tuning when first asked, each save stored and learned, the thresholds chosen again and stored
/// when they no longer stand.</summary>
/// <remarks>Safe to share across threads. Proposals for one scope run alongside each other; saves to one scope run one
/// at a time.</remarks>
public sealed class LowlineForms : IDisposable
{
    private readonly ILowlineStore _store;
    private readonly TimeProvider _time;
    private readonly ConcurrentDictionary<string, string> _definitions = new();
    private readonly ConcurrentDictionary<LowlineScope, Lazy<Task<Running>>> _running = new();

    /// <summary>Forms over <paramref name="store"/>; <paramref name="time"/> stamps each save (the system clock when
    /// left out).</summary>
    public LowlineForms(ILowlineStore store, TimeProvider? time = null)
    {
        ArgumentNullException.ThrowIfNull(store);
        _store = store;
        _time = time ?? TimeProvider.System;
    }

    /// <summary>Defines form <paramref name="form"/> by its definition (see <see cref="LowlineEngine.Create"/>; its
    /// <c>name</c> is set to the form's). Redefining a form starts its engines again on their next use.</summary>
    /// <exception cref="ArgumentException">The definition is not a JSON object.</exception>
    public void Define(string form, string definitionJson)
    {
        ArgumentException.ThrowIfNullOrEmpty(form);
        if (JsonNode.Parse(definitionJson) is not JsonObject definition)
        {
            throw new ArgumentException("A form's definition is a JSON object.", nameof(definitionJson));
        }

        definition["name"] = form;
        _definitions[form] = definition.ToJsonString();
        foreach (var scope in _running.Keys.Where(s => s.Form == form).ToList())
        {
            Stop(scope);
        }
    }

    /// <summary>What to show for each decided field of record <paramref name="id"/> that is still open, given its
    /// values so far — see <see cref="LowlineEngine.Propose"/>.</summary>
    public async Task<IReadOnlyList<Proposal>> ProposeAsync(
        LowlineScope scope,
        string id,
        IReadOnlyDictionary<string, FieldValue> values,
        IReadOnlyDictionary<string, IReadOnlyList<string>>? allowed = null,
        CancellationToken cancellationToken = default)
    {
        var running = await StartAsync(scope, cancellationToken).ConfigureAwait(false);
        return running.Engine.Propose(id, values, allowed);
    }

    /// <summary>Settles and stores record <paramref name="id"/> as saved — see <see cref="LowlineEngine.Settle"/>.
    /// When the thresholds no longer stand, they are chosen again on every stored record in the background — the
    /// engine answers with the ones it has meanwhile — then put in and stored; <see cref="WhenTunedAsync"/> waits for
    /// that.</summary>
    public async Task<SettledRecord> SettleAsync(
        LowlineScope scope,
        string id,
        IReadOnlyDictionary<string, FieldValue> saved,
        string? draft,
        SettledBy by = SettledBy.Person,
        CancellationToken cancellationToken = default)
    {
        var running = await StartAsync(scope, cancellationToken).ConfigureAwait(false);
        await running.Saving.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var record = running.Engine.Settle(id, saved, draft, by, _time.GetUtcNow());
            await _store.AddRecordAsync(scope, record, cancellationToken).ConfigureAwait(false);
            if (running.Engine.Stale is not null)
            {
                running.Retune(() => RetuneAsync(scope, running.Engine));
            }

            return record;
        }
        finally
        {
            running.Saving.Release();
        }
    }

    /// <summary>Completes when the scope's thresholds, if being chosen again after a save, are chosen and stored — and
    /// fails as that did. Completes at once when nothing is being chosen.</summary>
    public async Task WhenTunedAsync(LowlineScope scope)
    {
        if (_running.TryGetValue(scope, out var lazy) && lazy.IsValueCreated)
        {
            await (await lazy.Value.ConfigureAwait(false)).Tuned.ConfigureAwait(false);
        }
    }

    /// <summary>Removes the scope's records settled before <paramref name="before"/> from the store and starts its
    /// engine again from what is left on its next use; says how many went.</summary>
    public async Task<int> ForgetBeforeAsync(
        LowlineScope scope, DateTimeOffset before, CancellationToken cancellationToken = default)
    {
        var gone = await _store.ForgetBeforeAsync(scope, before, cancellationToken).ConfigureAwait(false);
        if (gone > 0)
        {
            Stop(scope);
        }

        return gone;
    }

    /// <summary>Removes the scope's record <paramref name="id"/> from the store and starts its engine again from what
    /// is left on its next use.</summary>
    public async Task<bool> ForgetAsync(LowlineScope scope, string id, CancellationToken cancellationToken = default)
    {
        var gone = await _store.ForgetAsync(scope, id, cancellationToken).ConfigureAwait(false);
        if (gone)
        {
            Stop(scope);
        }

        return gone;
    }

    private Task<Running> StartAsync(LowlineScope scope, CancellationToken cancellationToken)
    {
        if (!_definitions.TryGetValue(scope.Form, out var definition))
        {
            throw new ArgumentException($"No form is defined as '{scope.Form}'.", nameof(scope));
        }

        var lazy = _running.GetOrAdd(scope, s => new Lazy<Task<Running>>(() => Begin(s, definition)));
        var started = lazy.Value;
        if (started.IsFaulted || started.IsCanceled)
        {
            // A start that failed (the store unreachable, say) is tried again on the next use.
            _running.TryRemove(new KeyValuePair<LowlineScope, Lazy<Task<Running>>>(scope, lazy));
        }

        return started.WaitAsync(cancellationToken);
    }

    private async Task<Running> Begin(LowlineScope scope, string definition)
    {
        var engine = LowlineEngine.Create(definition);
        try
        {
            var records = await _store.ReadRecordsAsync(scope).ConfigureAwait(false);
            engine.Learn(records.Select(r => r.Json));
            engine.Restore(await _store.ReadTuningAsync(scope).ConfigureAwait(false));
            if (engine.Stale is not null)
            {
                // Nothing answers until thresholds are chosen, so the first start chooses them before it answers.
                var tuning = engine.Choose(records.Select(r => r.Json));
                engine.Restore(tuning);
                await _store.WriteTuningAsync(scope, tuning, CancellationToken.None).ConfigureAwait(false);
            }

            return new Running(engine);
        }
        catch
        {
            engine.Dispose();
            throw;
        }
    }

    private async Task RetuneAsync(LowlineScope scope, LowlineEngine engine)
    {
        var records = await _store.ReadRecordsAsync(scope).ConfigureAwait(false);
        var tuning = engine.Choose(records.Select(r => r.Json));
        engine.Restore(tuning);
        await _store.WriteTuningAsync(scope, tuning).ConfigureAwait(false);
    }

    private void Stop(LowlineScope scope)
    {
        if (_running.TryRemove(scope, out var lazy) && lazy.IsValueCreated && lazy.Value.IsCompletedSuccessfully)
        {
            lazy.Value.Result.Dispose();
        }
    }

    /// <summary>Frees every running engine.</summary>
    public void Dispose()
    {
        foreach (var scope in _running.Keys.ToList())
        {
            Stop(scope);
        }
    }

    private sealed class Running(LowlineEngine engine) : IDisposable
    {
        private readonly Lock _gate = new();

        public LowlineEngine Engine { get; } = engine;

        public SemaphoreSlim Saving { get; } = new(1, 1);

        /// <summary>The last choice of thresholds started after a save.</summary>
        public Task Tuned { get; private set; } = Task.CompletedTask;

        /// <summary>Starts <paramref name="retune"/> on a worker unless one is still running.</summary>
        public void Retune(Func<Task> retune)
        {
            lock (_gate)
            {
                if (!Tuned.IsCompleted)
                {
                    return;
                }

                Tuned = Task.Run(retune);
            }
        }

        public void Dispose()
        {
            Tuned.ContinueWith(
                _ =>
                {
                    Engine.Dispose();
                    Saving.Dispose();
                },
                CancellationToken.None,
                TaskContinuationOptions.ExecuteSynchronously,
                TaskScheduler.Default);
        }
    }
}
