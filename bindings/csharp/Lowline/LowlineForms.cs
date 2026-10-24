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
    private readonly ILowlineModel? _model;
    private readonly ConcurrentDictionary<string, string> _definitions = new();
    private readonly ConcurrentDictionary<LowlineScope, Lazy<Task<Running>>> _running = new();

    /// <summary>Forms over <paramref name="store"/>; <paramref name="time"/> stamps each save (the system clock when
    /// left out); <paramref name="model"/>, when given, fills forms from what a person wrote.</summary>
    public LowlineForms(ILowlineStore store, TimeProvider? time = null, ILowlineModel? model = null)
    {
        ArgumentNullException.ThrowIfNull(store);
        _store = store;
        _time = time ?? TimeProvider.System;
        _model = model;
    }

    /// <summary>Whether forms can be filled from what a person wrote: the host gave a model.</summary>
    public bool CanFill => _model is not null;

    /// <summary>Fills a record from <paramref name="text"/> through the host's model: the model is told the fields still
    /// empty, and what it answers is shown as suggestions from elsewhere — see <see cref="LowlineEngine.Fill"/>. Nothing
    /// is asked when no field is left to fill or nothing is written.</summary>
    /// <exception cref="InvalidOperationException">The host gave no model.</exception>
    public async Task<IReadOnlyList<Proposal>> FillAsync(
        LowlineScope scope,
        IReadOnlyDictionary<string, FieldValue> values,
        string text,
        IReadOnlyDictionary<string, IReadOnlyList<string>>? allowed = null,
        CancellationToken cancellationToken = default)
    {
        var model = _model
            ?? throw new InvalidOperationException("Lowline has no model to fill forms with: give one with UseModel.");
        var running = await StartAsync(scope, cancellationToken).ConfigureAwait(false);
        var fields = running.Engine.Describe(values, allowed);
        if (fields.Count == 0 || string.IsNullOrWhiteSpace(text))
        {
            return [];
        }

        var answered = await model.FillAsync(new LowlineFillRequest(scope.Form, fields, text, values), cancellationToken)
            .ConfigureAwait(false);
        return running.Engine.Fill(values, answered, allowed);
    }

    /// <summary>Answers, through the host's model, the decided fields of record <paramref name="id"/> the records
    /// could not: each field a proposal left as <see cref="Abstain.NeedsJudgement"/> with something to read is put to
    /// the model with what it asked to read — one with nothing to read yet is left as it is — and the model's values are
    /// offered back — see <see cref="LowlineEngine.Offer"/>. Gives the
    /// proposals of those fields only, in the form's order; none when every field was answered from the records. Kept
    /// apart from <see cref="ProposeAsync"/>, which answers at once: a model takes longer.</summary>
    /// <exception cref="InvalidOperationException">The host gave no model.</exception>
    public async Task<IReadOnlyList<Proposal>> JudgeAsync(
        LowlineScope scope,
        string id,
        IReadOnlyDictionary<string, FieldValue> values,
        IReadOnlyDictionary<string, IReadOnlyList<string>>? allowed = null,
        CancellationToken cancellationToken = default)
    {
        var model = _model
            ?? throw new InvalidOperationException("Lowline has no model to judge with: give one with UseModel.");
        var running = await StartAsync(scope, cancellationToken).ConfigureAwait(false);
        var asking = running.Engine.Propose(id, values, allowed)
            .Where(p => p.Abstain == Abstain.NeedsJudgement && p.Asks.Count > 0)
            .ToList();
        if (asking.Count == 0)
        {
            return [];
        }

        var choices = running.Engine.Describe(values, allowed).ToDictionary(f => f.Name, f => f.Choices);
        var judged = await Task.WhenAll(asking.Select(async asked =>
        {
            var evidence = asked.Asks.Select(pair => KeyValuePair.Create(pair[0], pair[1])).ToList();
            var request = new LowlineJudgeRequest(
                scope.Form, asked.Field, choices.GetValueOrDefault(asked.Field), evidence, values);
            var ranked = await model.JudgeAsync(request, cancellationToken).ConfigureAwait(false);
            return running.Engine.Offer(id, values, asked.Field, ranked, allowed) ?? asked;
        })).ConfigureAwait(false);
        return judged;
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

    /// <summary>What to show for the one decided field <paramref name="field"/> of record <paramref name="id"/> while
    /// a person types <paramref name="typed"/> into it — see <see cref="LowlineEngine.ProposeField"/>.</summary>
    public async Task<Proposal?> ProposeFieldAsync(
        LowlineScope scope,
        string id,
        IReadOnlyDictionary<string, FieldValue> values,
        string field,
        string? typed = null,
        IReadOnlyDictionary<string, IReadOnlyList<string>>? allowed = null,
        CancellationToken cancellationToken = default)
    {
        var running = await StartAsync(scope, cancellationToken).ConfigureAwait(false);
        return running.Engine.ProposeField(id, values, field, typed, allowed);
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

    /// <summary>How far the scope's records have come, per decided field in the form's order — the thresholds chosen and
    /// what the replay saw at them, or how close it came — see <see cref="LowlineEngine.Report"/>. Starts the scope's
    /// engine from storage when it is not running, choosing its thresholds if none stand; empty for a form that decides
    /// nothing.</summary>
    public async Task<IReadOnlyList<FieldReport>> ReportAsync(
        LowlineScope scope, CancellationToken cancellationToken = default)
    {
        var running = await StartAsync(scope, cancellationToken).ConfigureAwait(false);
        return running.Engine.Report ?? [];
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

    /// <summary>Removes the scope's records settled before <paramref name="before"/> from the store, and has its
    /// engine, if running, forget them (see <see cref="LowlineEngine.Forget"/>) — choosing thresholds again in the
    /// background when the rest no longer bear them out; says how many went.</summary>
    public async Task<int> ForgetBeforeAsync(
        LowlineScope scope, DateTimeOffset before, CancellationToken cancellationToken = default)
    {
        IReadOnlyList<string> gone = [];
        await ForgettingAsync(scope, async () =>
        {
            gone = await _store.ForgetBeforeAsync(scope, before, cancellationToken).ConfigureAwait(false);
            return gone;
        }, cancellationToken).ConfigureAwait(false);
        return gone.Count;
    }

    /// <summary>Removes the scope's record <paramref name="id"/> from the store, and has its engine, if running,
    /// forget it — choosing thresholds again in the background when the rest no longer bear them out.</summary>
    public async Task<bool> ForgetAsync(LowlineScope scope, string id, CancellationToken cancellationToken = default)
    {
        var gone = false;
        await ForgettingAsync(scope, async () =>
        {
            gone = await _store.ForgetAsync(scope, id, cancellationToken).ConfigureAwait(false);
            return gone ? [id] : [];
        }, cancellationToken).ConfigureAwait(false);
        return gone;
    }

    /// <summary>Runs <paramref name="forget"/> — removing records from the store, answering their ids — between the
    /// saves to a running engine, which then forgets them. A scope whose engine is still starting starts again from the
    /// store on its next use; one not running reads the store as it is then.</summary>
    private async Task ForgettingAsync(
        LowlineScope scope, Func<Task<IReadOnlyList<string>>> forget, CancellationToken cancellationToken)
    {
        if (!_running.TryGetValue(scope, out var lazy) || !lazy.IsValueCreated || !lazy.Value.IsCompletedSuccessfully)
        {
            var gone = await forget().ConfigureAwait(false);
            if (gone.Count > 0 && lazy is not null)
            {
                Stop(scope);
            }

            return;
        }

        var running = lazy.Value.Result;
        await running.Saving.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var gone = await forget().ConfigureAwait(false);
            if (gone.Count == 0)
            {
                return;
            }

            running.Engine.Forget(gone);
            if (running.Engine.Stale is not null)
            {
                running.Retune(() => RetuneAsync(scope, running.Engine));
            }
        }
        finally
        {
            running.Saving.Release();
        }
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

        private bool _tuning;
        private bool _again;

        /// <summary>The choice of thresholds running after a save, with any it has to run again.</summary>
        public Task Tuned { get; private set; } = Task.CompletedTask;

        /// <summary>Starts <paramref name="retune"/> on a worker. Asked while one runs, it runs once more after that one
        /// if the thresholds then still do not stand — the records saved meanwhile were not in the one running.</summary>
        public void Retune(Func<Task> retune)
        {
            lock (_gate)
            {
                if (_tuning)
                {
                    _again = true;
                    return;
                }

                _tuning = true;
                Tuned = Task.Run(() => Run(retune));
            }
        }

        private async Task Run(Func<Task> retune)
        {
            try
            {
                while (true)
                {
                    await retune().ConfigureAwait(false);
                    lock (_gate)
                    {
                        var again = _again && Engine.Stale is not null;
                        _again = false;
                        if (!again)
                        {
                            _tuning = false;
                            return;
                        }
                    }
                }
            }
            catch
            {
                lock (_gate)
                {
                    _tuning = false;
                    _again = false;
                }

                throw;
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
