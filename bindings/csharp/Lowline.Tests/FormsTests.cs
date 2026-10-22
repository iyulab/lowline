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
