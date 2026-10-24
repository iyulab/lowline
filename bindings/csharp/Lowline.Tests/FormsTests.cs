using AwesomeAssertions;

namespace Lowline.Tests;

/// <summary>A host's forms over its store: engines started from storage, saves stored and learned, thresholds chosen
/// again and stored, memory spaces kept apart, and records forgotten.</summary>
public sealed class FormsTests
{
    private static readonly LowlineScope Seoul = new("intake", "seoul");
    private static readonly LowlineScope Busan = new("intake", "busan");

    private static async Task<InMemoryLowlineStore> StoreWith(LowlineScope scope, IEnumerable<SettledRecord> records)
    {
        var store = new InMemoryLowlineStore();
        foreach (var record in records)
        {
            await store.AddRecordAsync(scope, record, Ct);
        }

        return store;
    }

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static Dictionary<string, FieldValue> Customer(string name) => new() { ["customer"] = name };

    [Fact]
    public async Task An_engine_starts_from_the_store_and_keeps_its_tuning_there()
    {
        var store = await StoreWith(Seoul, EngineTests.Alternating(40));
        using var forms = new LowlineForms(store);
        forms.Define("intake", EngineTests.Intake);

        var shown = await forms.ProposeAsync(Seoul, "new", Customer("Beta"), cancellationToken: Ct);
        shown[0].Suggestion!.Value.Should().Be("lee");
        (await store.ReadTuningAsync(Seoul, Ct)).Should().NotBeNull("the thresholds chosen at start-up are stored");

        var saved = await forms.SettleAsync(
            Seoul,
            "new",
            new Dictionary<string, FieldValue> { ["customer"] = "Beta", ["owner"] = "lee" },
            EngineTests.Shown("owner", "lee"),
            cancellationToken: Ct);
        (await store.ReadRecordsAsync(Seoul, Ct)).Should().HaveCount(41).And.Contain(saved);
    }

    [Fact]
    public async Task Memory_spaces_do_not_answer_for_each_other()
    {
        var store = await StoreWith(Seoul, EngineTests.Alternating(40));
        using var forms = new LowlineForms(store);
        forms.Define("intake", EngineTests.Intake);

        (await forms.ProposeAsync(Seoul, "new", Customer("Beta"), cancellationToken: Ct))[0].Suggestion.Should().NotBeNull();
        var busan = await forms.ProposeAsync(Busan, "new", Customer("Beta"), cancellationToken: Ct);
        busan[0].Suggestion.Should().BeNull();
        busan[0].Abstain.Should().Be(Abstain.NeedsJudgement);
    }

    [Fact]
    public async Task The_thresholds_are_chosen_again_once_a_tenth_more_is_saved()
    {
        var store = await StoreWith(Seoul, EngineTests.Alternating(40));
        var clock = new Clock(EngineTests.Start.AddHours(1));
        using var forms = new LowlineForms(store, clock);
        forms.Define("intake", EngineTests.Intake);
        await forms.ProposeAsync(Seoul, "first", Customer("Acme"), cancellationToken: Ct);
        var before = await store.ReadTuningAsync(Seoul, Ct);

        for (var i = 0; i < 4; i++)
        {
            await forms.SettleAsync(
                Seoul, $"n{i}", new Dictionary<string, FieldValue> { ["customer"] = "Acme", ["owner"] = "kim" }, null,
                cancellationToken: Ct);
        }

        await forms.WhenTunedAsync(Seoul);
        var after = await store.ReadTuningAsync(Seoul, Ct);
        after.Should().NotBe(before);
        after.Should().Contain("\"settled\":44");
    }

    [Fact]
    public async Task Saves_while_thresholds_are_chosen_have_them_chosen_again_after()
    {
        var store = new SlowChoice(await StoreWith(Seoul, EngineTests.Alternating(10)));
        var clock = new Clock(EngineTests.Start.AddHours(1));
        using var forms = new LowlineForms(store, clock);
        forms.Define("intake", EngineTests.Intake);
        await forms.ProposeAsync(Seoul, "first", Customer("Acme"), cancellationToken: Ct);

        // The first save starts a choice that reads the store and is slow to finish; thirty more saves land meanwhile.
        store.Slow = new TaskCompletionSource();
        for (var i = 0; i < 31; i++)
        {
            await forms.SettleAsync(
                Seoul, $"n{i}", new Dictionary<string, FieldValue> { ["customer"] = "Acme", ["owner"] = "kim" }, null,
                cancellationToken: Ct);
        }

        store.Slow.SetResult();
        await forms.WhenTunedAsync(Seoul);
        (await store.ReadTuningAsync(Seoul, Ct)).Should().Contain("\"settled\":41");
        (await forms.ReportAsync(Seoul, Ct)).Single().ChosenOn.Should().Be(41);
    }

    [Fact]
    public async Task A_tuning_the_stored_records_outgrew_is_chosen_again_at_start_up()
    {
        var store = await StoreWith(Seoul, EngineTests.Alternating(10));
        using (var forms = new LowlineForms(store))
        {
            forms.Define("intake", EngineTests.Intake);
            await forms.ProposeAsync(Seoul, "first", Customer("Acme"), cancellationToken: Ct);
        }

        (await store.ReadTuningAsync(Seoul, Ct)).Should().Contain("\"settled\":10");
        foreach (var record in EngineTests.Alternating(40).Skip(10))
        {
            await store.AddRecordAsync(Seoul, record, Ct);
        }

        using var again = new LowlineForms(store);
        again.Define("intake", EngineTests.Intake);
        var report = (await again.ReportAsync(Seoul, Ct)).Single();
        report.Lookups.Should().Be(39);
        report.ChosenOn.Should().Be(40);
        (await store.ReadTuningAsync(Seoul, Ct)).Should().Contain("\"settled\":40");
    }

    /// <summary>A store whose reads of the records, once <see cref="Slow"/> is set, answer only when it completes —
    /// with the records as they were when asked, as a long choice of thresholds would see them.</summary>
    private sealed class SlowChoice(InMemoryLowlineStore inner) : ILowlineStore
    {
        public TaskCompletionSource? Slow { get; set; }

        public async Task<IReadOnlyList<SettledRecord>> ReadRecordsAsync(
            LowlineScope scope, CancellationToken cancellationToken = default)
        {
            var records = await inner.ReadRecordsAsync(scope, cancellationToken);
            if (Slow is { } slow)
            {
                await slow.Task;
            }

            return records;
        }

        public Task AddRecordAsync(LowlineScope scope, SettledRecord record, CancellationToken cancellationToken = default) =>
            inner.AddRecordAsync(scope, record, cancellationToken);

        public Task<string?> ReadTuningAsync(LowlineScope scope, CancellationToken cancellationToken = default) =>
            inner.ReadTuningAsync(scope, cancellationToken);

        public Task WriteTuningAsync(LowlineScope scope, string tuning, CancellationToken cancellationToken = default) =>
            inner.WriteTuningAsync(scope, tuning, cancellationToken);

        public Task<IReadOnlyList<string>> ForgetBeforeAsync(
            LowlineScope scope, DateTimeOffset before, CancellationToken cancellationToken = default) =>
            inner.ForgetBeforeAsync(scope, before, cancellationToken);

        public Task<bool> ForgetAsync(LowlineScope scope, string id, CancellationToken cancellationToken = default) =>
            inner.ForgetAsync(scope, id, cancellationToken);
    }

    [Fact]
    public async Task Forgotten_records_no_longer_answer()
    {
        var store = await StoreWith(Seoul, EngineTests.Alternating(40));
        using var forms = new LowlineForms(store);
        forms.Define("intake", EngineTests.Intake);
        (await forms.ProposeAsync(Seoul, "new", Customer("Beta"), cancellationToken: Ct))[0].Suggestion.Should().NotBeNull();

        var gone = await forms.ForgetBeforeAsync(Seoul, EngineTests.Start.AddDays(1), Ct);
        gone.Should().Be(40);
        (await store.ReadRecordsAsync(Seoul, Ct)).Should().BeEmpty();
        (await forms.ProposeAsync(Seoul, "new", Customer("Beta"), cancellationToken: Ct))[0].Suggestion.Should().BeNull();
    }

    [Fact]
    public async Task A_record_forgotten_while_its_engine_runs_answers_no_more()
    {
        var records = EngineTests.Alternating(40);
        var store = await StoreWith(Seoul, records);
        using var forms = new LowlineForms(store);
        forms.Define("intake", EngineTests.Intake);
        (await forms.ProposeAsync(Seoul, "new", Customer("Acme"), cancellationToken: Ct))[0].Suggestion!.Value.Should().Be("kim");

        // Every Acme record goes, one by one, while the engine runs: it forgets each, and Acme is answered no more.
        foreach (var id in Enumerable.Range(0, 40).Where(i => i % 2 == 0).Select(i => $"r{i}"))
        {
            (await forms.ForgetAsync(Seoul, id, Ct)).Should().BeTrue();
        }

        (await forms.ForgetAsync(Seoul, "r0", Ct)).Should().BeFalse();
        (await forms.ProposeAsync(Seoul, "new", Customer("Acme"), cancellationToken: Ct))[0].Suggestion.Should().BeNull();
        await forms.WhenTunedAsync(Seoul);
        (await forms.ProposeAsync(Seoul, "new", Customer("Beta"), cancellationToken: Ct))[0].Suggestion!.Value.Should().Be("lee");
    }

    [Fact]
    public async Task An_undefined_form_is_refused()
    {
        using var forms = new LowlineForms(new InMemoryLowlineStore());
        var act = () => forms.ProposeAsync(new LowlineScope("nothing", "x"), "r", Customer("Acme"), cancellationToken: Ct);
        await act.Should().ThrowAsync<ArgumentException>().WithMessage("No form is defined as 'nothing'.*");
    }

    private sealed class Clock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
