using System.Text;
using System.Text.Json;

namespace Lowline;

/// <summary>One form's round with the decider: the records settled for it learned, its decided fields answered, a
/// person's save settled and learned from, and its thresholds chosen again when they no longer stand.</summary>
/// <remarks>
/// The engine keeps what answers but stores nothing: hand it the stored records (<see cref="Learn"/>) and the stored
/// tuning (<see cref="Restore"/>) when it starts, store each record <see cref="Settle"/> gives back, and store the
/// tuning <see cref="Tune"/> gives back. Keep one engine per form and per store — records kept apart, one workplace's
/// from another's, take engines of their own. <see cref="LowlineForms"/> does all of that over an
/// <see cref="ILowlineStore"/>.
/// <para>Safe to share across threads: <see cref="Propose"/> runs alongside other proposals; the calls that change the
/// engine run one at a time.</para>
/// </remarks>
public sealed unsafe class LowlineEngine : IDisposable
{
    private readonly ReaderWriterLockSlim _lock = new();
    private nint _handle;

    private LowlineEngine(nint handle) => _handle = handle;

    /// <summary>An engine for the form <paramref name="definitionJson"/> describes: a JSON object with <c>name</c> (what
    /// the decider's memories are kept under), the form as <c>form</c> (the engine's form: <c>fields</c>, each with
    /// <c>name</c>, <c>kind</c> and, for a choice, <c>choices</c>) or as <c>formdown</c> (what formdown's
    /// <c>getSchema()</c> gives), and optionally <c>inference</c> and <c>tune</c>.</summary>
    /// <exception cref="ArgumentException">The definition does not read, or its form has no field to decide.</exception>
    public static LowlineEngine Create(string definitionJson)
    {
        ArgumentNullException.ThrowIfNull(definitionJson);
        Native.EnsureCompatible();
        var text = new Utf8(definitionJson);
        nint handle;
        fixed (byte* p = text.Bytes)
        {
            Native.Check(Native.EngineNew(text.At(p), &handle));
        }

        return new LowlineEngine(handle);
    }

    /// <summary>How many records the engine has learned, one per record id.</summary>
    public int Settled
    {
        get
        {
            using var _ = Read();
            return (int)Native.EngineSettled(_handle);
        }
    }

    /// <summary>Learns settled records — the stored ones at start-up, or ones settled elsewhere since — in settlement
    /// order. A record whose id was learned before replaces what that one taught.</summary>
    /// <exception cref="ArgumentException">A record does not read, or holds a value for a field the form does not have;
    /// nothing is learned.</exception>
    public void Learn(IEnumerable<string> records)
    {
        var lines = new Utf8(Lines(records));
        using var _ = Write();
        fixed (byte* p = lines.Bytes)
        {
            Native.Check(Native.EngineLearn(_handle, lines.At(p)));
        }
    }

    /// <summary>Puts back a tuning the host stored; <c>null</c> leaves the engine untuned. Restore it after learning the
    /// stored records, so that whether it still stands is judged on them.</summary>
    public void Restore(string? tuning)
    {
        var text = new Utf8(tuning);
        using var _ = Write();
        fixed (byte* p = text.Bytes)
        {
            Native.Check(Native.EngineRestore(_handle, text.At(p)));
        }
    }

    /// <summary>Why the thresholds should be chosen again, or <c>null</c> while they stand: <c>untuned</c> when none
    /// were chosen or restored, or <c>tuning</c> with the decider's reason as <see cref="Staleness.Detail"/> — another
    /// version of it, a changed form, or the learned records grown or shrunk by a tenth since the choice.</summary>
    public Staleness? Stale
    {
        get
        {
            nuint length;
            string json;
            using (Read())
            {
                Native.Check(Native.EngineStale(_handle, &length));
                json = Native.Result(length);
            }

            var element = JsonSerializer.Deserialize(json, LowlineJson.Default.JsonElement);
            return element.ValueKind switch
            {
                JsonValueKind.Null => null,
                JsonValueKind.String => new Staleness(element.GetString()!),
                _ => element.EnumerateObject().Select(p => new Staleness(p.Name, p.Value.Clone())).Single(),
            };
        }
    }

    /// <summary>How each decided field's replays went when the thresholds were chosen, in the form's order — kept with
    /// the tuning, so an engine restored from storage reports the same; <c>null</c> while none were chosen or restored.
    /// </summary>
    public IReadOnlyList<FieldReport>? Report
    {
        get
        {
            nuint length;
            string json;
            using (Read())
            {
                Native.Check(Native.EngineReport(_handle, &length));
                json = Native.Result(length);
            }

            return JsonSerializer.Deserialize(json, LowlineJson.Default.ListFieldReport);
        }
    }

    /// <summary>Chooses the decided fields' thresholds again on the settled records — all of them, as the host stores
    /// them — and learns them; returns the tuning to store.</summary>
    public string Tune(IEnumerable<string> records)
    {
        var lines = new Utf8(Lines(records));
        nuint length;
        using var _ = Write();
        fixed (byte* p = lines.Bytes)
        {
            Native.Check(Native.EngineTune(_handle, lines.At(p), &length));
        }

        return Native.Result(length);
    }

    /// <summary>The tuning <see cref="Tune"/> would choose on <paramref name="records"/>, leaving the engine as it is:
    /// proposals go on alongside it. Put the result in with <see cref="Restore"/>. The records should be the ones the
    /// engine has learned.</summary>
    public string Choose(IEnumerable<string> records)
    {
        var lines = new Utf8(Lines(records));
        nuint length;
        using var _ = Read();
        fixed (byte* p = lines.Bytes)
        {
            Native.Check(Native.EngineChoose(_handle, lines.At(p), &length));
        }

        return Native.Result(length);
    }

    /// <summary>What to show for each decided field of record <paramref name="id"/> that is still open, given its
    /// values so far, in the form's order. <paramref name="allowed"/> holds, by field, the choices this person may pick
    /// now; a field it leaves out may take any value. The record's own saved version is not evidence for itself.
    /// </summary>
    public IReadOnlyList<Proposal> Propose(
        string id,
        IReadOnlyDictionary<string, FieldValue> values,
        IReadOnlyDictionary<string, IReadOnlyList<string>>? allowed = null)
    {
        var idText = new Utf8(id);
        var valuesText = new Utf8(JsonSerializer.Serialize(new Dictionary<string, FieldValue>(values),
            LowlineJson.Default.DictionaryStringFieldValue));
        var allowedText = new Utf8(allowed is null
            ? null
            : JsonSerializer.Serialize(new Dictionary<string, IReadOnlyList<string>>(allowed),
                LowlineJson.Default.DictionaryStringIReadOnlyListString));
        nuint length;
        string json;
        using (Read())
        {
            fixed (byte* i = idText.Bytes, v = valuesText.Bytes, a = allowedText.Bytes)
            {
                Native.Check(Native.EnginePropose(_handle, idText.At(i), valuesText.At(v), allowedText.At(a), &length));
            }

            json = Native.Result(length);
        }

        return JsonSerializer.Deserialize(json, LowlineJson.Default.ListProposal)!;
    }

    /// <summary>What to show for the one decided field <paramref name="field"/> of record <paramref name="id"/>, given
    /// its values so far and <paramref name="typed"/>, the text a person has typed into it so far — asked again with
    /// each character while the field stays open. With text typed, only a value that begins with it is suggested (ignoring
    /// case), from values settled together with this record's other values, held to the threshold chosen for that many
    /// characters; a field not written out as free text, or typed past the lengths thresholds were chosen for, is answered
    /// nothing while typed into (<see cref="Abstain.Unsure"/>). Without text typed it is the field's proposal among
    /// <see cref="Propose"/>'s. <c>null</c> when the field is not a decided field still open.</summary>
    public Proposal? ProposeField(
        string id,
        IReadOnlyDictionary<string, FieldValue> values,
        string field,
        string? typed = null,
        IReadOnlyDictionary<string, IReadOnlyList<string>>? allowed = null)
    {
        var idText = new Utf8(id);
        var valuesText = new Utf8(Values(values));
        var allowedText = new Utf8(Allowed(allowed));
        var fieldText = new Utf8(field);
        var typedText = new Utf8(typed);
        nuint length;
        string json;
        using (Read())
        {
            fixed (byte* i = idText.Bytes, v = valuesText.Bytes, a = allowedText.Bytes, f = fieldText.Bytes,
                   t = typedText.Bytes)
            {
                Native.Check(Native.EngineProposeField(
                    _handle, idText.At(i), valuesText.At(v), allowedText.At(a), fieldText.At(f), typedText.At(t),
                    &length));
            }

            json = Native.Result(length);
        }

        return JsonSerializer.Deserialize(json, LowlineJson.Default.Proposal);
    }

    /// <summary>The fields a host's model may fill for a record holding <paramref name="values"/>: those still empty
    /// that take one value, a closed choice field's choices narrowed to those this person may pick
    /// (<paramref name="allowed"/>). What to tell the model to answer.</summary>
    public IReadOnlyList<FillField> Describe(
        IReadOnlyDictionary<string, FieldValue> values,
        IReadOnlyDictionary<string, IReadOnlyList<string>>? allowed = null)
    {
        var valuesText = new Utf8(Values(values));
        var allowedText = new Utf8(Allowed(allowed));
        nuint length;
        string json;
        using (Read())
        {
            fixed (byte* v = valuesText.Bytes, a = allowedText.Bytes)
            {
                Native.Check(Native.EngineDescribe(_handle, valuesText.At(v), allowedText.At(a), &length));
            }

            json = Native.Result(length);
        }

        return JsonSerializer.Deserialize(json, LowlineJson.Default.ListFillField)!;
    }

    /// <summary>What to show for each field the host's model answered (<paramref name="answered"/>) for a record
    /// holding <paramref name="values"/>: its value as a suggestion from elsewhere — shown for the person to take, never
    /// put in on its own, and not counted for the decider — or why there is none.</summary>
    public IReadOnlyList<Proposal> Fill(
        IReadOnlyDictionary<string, FieldValue> values,
        IReadOnlyDictionary<string, FieldValue> answered,
        IReadOnlyDictionary<string, IReadOnlyList<string>>? allowed = null)
    {
        var valuesText = new Utf8(Values(values));
        var allowedText = new Utf8(Allowed(allowed));
        var answeredText = new Utf8(Values(answered));
        nuint length;
        string json;
        using (Read())
        {
            fixed (byte* v = valuesText.Bytes, a = allowedText.Bytes, m = answeredText.Bytes)
            {
                Native.Check(Native.EngineFill(
                    _handle, valuesText.At(v), allowedText.At(a), answeredText.At(m), &length));
            }

            json = Native.Result(length);
        }

        return JsonSerializer.Deserialize(json, LowlineJson.Default.ListProposal)!;
    }

    /// <summary>What to show for the decided field <paramref name="field"/> of record <paramref name="id"/> once the
    /// host's model has judged what a proposal asked for (<see cref="Abstain.NeedsJudgement"/>, the fields and values
    /// to read in <see cref="Proposal.Asks"/>). <paramref name="ranked"/> holds the model's values, best first. They
    /// join the decider's candidates after values a memory trusts and before its guesses; a trusted one among the
    /// field's choices is shown as the decider's answer from the <see cref="Layer.Judgement"/> layer, so a person
    /// taking it settles it as any other answer. Where a memory has evidence the judgement changes nothing.
    /// <c>null</c> when the field is not a decided field still open.</summary>
    public Proposal? Offer(
        string id,
        IReadOnlyDictionary<string, FieldValue> values,
        string field,
        IReadOnlyList<JudgedValue> ranked,
        IReadOnlyDictionary<string, IReadOnlyList<string>>? allowed = null)
    {
        var idText = new Utf8(id);
        var valuesText = new Utf8(Values(values));
        var allowedText = new Utf8(Allowed(allowed));
        var fieldText = new Utf8(field);
        var rankedText = new Utf8(JsonSerializer.Serialize(ranked.ToList(), LowlineJson.Default.ListJudgedValue));
        nuint length;
        string json;
        using (Read())
        {
            fixed (byte* i = idText.Bytes, v = valuesText.Bytes, a = allowedText.Bytes, f = fieldText.Bytes,
                   r = rankedText.Bytes)
            {
                Native.Check(Native.EngineOffer(
                    _handle, idText.At(i), valuesText.At(v), allowedText.At(a), fieldText.At(f), rankedText.At(r),
                    &length));
            }

            json = Native.Result(length);
        }

        return JsonSerializer.Deserialize(json, LowlineJson.Default.Proposal);
    }

    private static string Values(IReadOnlyDictionary<string, FieldValue> values) =>
        JsonSerializer.Serialize(new Dictionary<string, FieldValue>(values), LowlineJson.Default.DictionaryStringFieldValue);

    private static string? Allowed(IReadOnlyDictionary<string, IReadOnlyList<string>>? allowed) =>
        allowed is null
            ? null
            : JsonSerializer.Serialize(new Dictionary<string, IReadOnlyList<string>>(allowed),
                LowlineJson.Default.DictionaryStringIReadOnlyListString);

    /// <summary>Settles record <paramref name="id"/> as saved — its values, and <paramref name="draft"/>, the account
    /// kept while it was written (what was shown, taken, turned down; <c>null</c> for a record written with nothing
    /// shown) — learns it, and gives back the record to store.</summary>
    public SettledRecord Settle(
        string id,
        IReadOnlyDictionary<string, FieldValue> saved,
        string? draft,
        SettledBy by,
        DateTimeOffset settledAt)
    {
        var idText = new Utf8(id);
        var savedText = new Utf8(JsonSerializer.Serialize(new Dictionary<string, FieldValue>(saved),
            LowlineJson.Default.DictionaryStringFieldValue));
        var draftText = new Utf8(draft);
        var ticks = Ticks(settledAt);
        var party = by == SettledBy.Person ? Native.SettledByPerson : Native.SettledByApplication;
        nuint length;
        string json;
        using (Write())
        {
            fixed (byte* i = idText.Bytes, s = savedText.Bytes, d = draftText.Bytes)
            {
                Native.Check(Native.EngineSettle(
                    _handle, idText.At(i), savedText.At(s), draftText.At(d), party, ticks, &length));
            }

            json = Native.Result(length);
        }

        return new SettledRecord(id, settledAt, json);
    }

    /// <summary>The record to store for <paramref name="id"/>, settled elsewhere — for a host whose records are kept
    /// somewhere of its own (files, an existing database) and that builds the engine's store from them: its
    /// <paramref name="saved"/> values, how each decided field was settled (<paramref name="settled"/>; a decided field
    /// left out was settled by a person with nothing in view) and when. Nothing is learned: hand the records to
    /// <see cref="Learn"/> together, in settlement order. A field with no value saved is not settled.</summary>
    /// <exception cref="ArgumentException">A value or settlement the form does not hold.</exception>
    public SettledRecord Record(
        string id,
        IReadOnlyDictionary<string, FieldValue> saved,
        IReadOnlyDictionary<string, SettlementKind>? settled,
        DateTimeOffset settledAt)
    {
        var idText = new Utf8(id);
        var savedText = new Utf8(Values(saved));
        var settledText = new Utf8(settled is null
            ? null
            : JsonSerializer.Serialize(new Dictionary<string, SettlementKind>(settled),
                LowlineJson.Default.DictionaryStringSettlementKind));
        nuint length;
        string json;
        using (Read())
        {
            fixed (byte* i = idText.Bytes, s = savedText.Bytes, k = settledText.Bytes)
            {
                Native.Check(Native.EngineRecord(
                    _handle, idText.At(i), savedText.At(s), settledText.At(k), Ticks(settledAt), &length));
            }

            json = Native.Result(length);
        }

        return new SettledRecord(id, settledAt, json);
    }

    /// <summary>A time in the engine's unit: 100-nanosecond ticks since the Unix epoch, UTC.</summary>
    internal static long Ticks(DateTimeOffset at) => at.UtcTicks - DateTimeOffset.UnixEpoch.UtcTicks;

    private static string Lines(IEnumerable<string> records)
    {
        ArgumentNullException.ThrowIfNull(records);
        var text = new StringBuilder();
        foreach (var record in records)
        {
            text.Append(record).Append('\n');
        }

        return text.ToString();
    }

    private Held Read()
    {
        _lock.EnterReadLock();
        if (_handle == 0)
        {
            _lock.ExitReadLock();
            throw new ObjectDisposedException(nameof(LowlineEngine));
        }

        return new Held(_lock, write: false);
    }

    private Held Write()
    {
        _lock.EnterWriteLock();
        if (_handle == 0)
        {
            _lock.ExitWriteLock();
            throw new ObjectDisposedException(nameof(LowlineEngine));
        }

        return new Held(_lock, write: true);
    }

    /// <summary>Frees the native engine.</summary>
    public void Dispose()
    {
        _lock.EnterWriteLock();
        try
        {
            Native.EngineFree(_handle);
            _handle = 0;
        }
        finally
        {
            _lock.ExitWriteLock();
        }
    }

    private readonly struct Held(ReaderWriterLockSlim held, bool write) : IDisposable
    {
        public void Dispose()
        {
            if (write)
            {
                held.ExitWriteLock();
            }
            else
            {
                held.ExitReadLock();
            }
        }
    }
}

/// <summary>An engine an earlier call left broken: a call that changed it failed partway, so what it holds can no
/// longer be trusted. Dispose it and build it again from the stored records.</summary>
public sealed class LowlineBrokenException(string message) : InvalidOperationException(message);
