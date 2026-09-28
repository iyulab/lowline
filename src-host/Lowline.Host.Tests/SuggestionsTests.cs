using System.Text.Json;

namespace Lowline.Host.Tests;

public sealed class SuggestionsTests
{
    private static readonly TemplateSnapshot Intake = new("intake@1",
    [
        new TemplateField("요청", "textarea"),
        new TemplateField("부서", "text"),
        new TemplateField("담당", "select"),
    ], Suggest: ["담당"]);

    private static IReadOnlyDictionary<string, JsonElement> Values(string json) =>
        JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(json)!;

    private static DocumentSnapshot Document(string path, string json) => new(path, "intake@1", Values(json));

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static async Task<VaultProjection> Vault(params DocumentSnapshot[] documents)
    {
        var vault = new VaultProjection();
        await vault.IngestAsync(new VaultSnapshot([Intake], documents), Ct);
        return vault;
    }

    [Fact]
    public async Task Suggests_the_value_confirmed_for_a_similar_document()
    {
        var vault = await Vault(
            Document("문서/1.md", """{"요청": "노트북 배터리가 금방 닳아요", "부서": "영업", "담당": "장비"}"""),
            Document("문서/2.md", """{"요청": "급여 명세서를 다시 받고 싶어요", "부서": "개발", "담당": "인사"}"""));

        var suggestion = await vault.SuggestAsync(
            new SuggestRequest("intake@1", "담당", Values("""{"요청": "노트북 배터리가 금방 닳아요!", "부서": "기획"}""")), Ct);

        Assert.NotNull(suggestion);
        Assert.Equal("장비", suggestion.Value);
        Assert.Equal("memory", suggestion.Mode);
        Assert.Equal("문서/1.md", suggestion.Source);
        Assert.True(suggestion.Similarity >= Suggestions.PriorThreshold);
        Assert.True(vault.MemoryReady);
    }

    [Fact]
    public async Task Does_not_offer_a_value_only_another_fields_value_backs()
    {
        // 인사 was confirmed with 부서 개발, but the request itself resembles nothing confirmed.
        var vault = await Vault(
            Document("문서/1.md", """{"요청": "노트북 배터리가 금방 닳아요", "부서": "영업", "담당": "장비"}"""),
            Document("문서/2.md", """{"요청": "급여 명세서를 다시 받고 싶어요", "부서": "개발", "담당": "인사"}"""));

        var suggestion = await vault.SuggestAsync(
            new SuggestRequest("intake@1", "담당", Values("""{"요청": "회의실 예약 방법이 궁금합니다", "부서": "개발"}""")), Ct);

        Assert.Equal(new Suggestion(null, "abstain", null, null), suggestion);
    }

    [Fact]
    public async Task Does_not_offer_a_value_nothing_in_the_document_backs()
    {
        // 장비 is the field's most frequent value, but nothing in this document points to it.
        var vault = await Vault(
            Document("문서/1.md", """{"요청": "노트북 배터리가 금방 닳아요", "부서": "영업", "담당": "장비"}"""),
            Document("문서/2.md", """{"요청": "모니터가 깜빡여요", "부서": "영업", "담당": "장비"}"""));

        var suggestion = await vault.SuggestAsync(
            new SuggestRequest("intake@1", "담당", Values("""{"요청": "회의실 예약 방법이 궁금합니다", "부서": "총무"}""")), Ct);

        Assert.Equal(new Suggestion(null, "abstain", null, null), suggestion);
    }

    [Fact]
    public async Task A_document_is_not_its_own_similar_document()
    {
        var vault = await Vault(Document("문서/1.md", """{"요청": "노트북 배터리가 금방 닳아요", "담당": "장비"}"""));

        var suggestion = await vault.SuggestAsync(
            new SuggestRequest("intake@1", "담당", Values("""{"요청": "노트북 배터리가 금방 닳아요!"}"""), "문서/1.md"), Ct);

        Assert.Null(suggestion!.Value);
    }

    [Fact]
    public async Task Abstains_when_nothing_confirmed_is_close_enough()
    {
        var vault = await Vault(Document("문서/1.md", """{"요청": "노트북 배터리가 금방 닳아요", "담당": "장비"}"""));

        var suggestion = await vault.SuggestAsync(
            new SuggestRequest("intake@1", "담당", Values("""{"요청": "회의실 예약 방법이 궁금합니다"}""")), Ct);

        Assert.Equal(new Suggestion(null, "abstain", null, null), suggestion);
    }

    [Fact]
    public async Task Abstains_on_an_empty_document_and_with_an_empty_memory()
    {
        var empty = await Vault();
        var none = await empty.SuggestAsync(new SuggestRequest("intake@1", "담당", Values("""{"요청": "무엇이든"}""")), Ct);
        Assert.Null(none!.Value);

        var vault = await Vault(Document("문서/1.md", """{"요청": "배터리", "담당": "장비"}"""));
        var blank = await vault.SuggestAsync(new SuggestRequest("intake@1", "담당", Values("{}")), Ct);
        Assert.Equal(new Suggestion(null, "abstain", null, null), blank);
    }

    [Fact]
    public async Task Offers_nothing_for_a_field_the_author_did_not_turn_suggestions_on_for()
    {
        var vault = await Vault(Document("문서/1.md", """{"요청": "배터리", "부서": "영업", "담당": "장비"}"""));
        Assert.Null(await vault.SuggestAsync(new SuggestRequest("intake@1", "부서", Values("""{"요청": "배터리"}""")), Ct));
        Assert.Null(await vault.SuggestAsync(new SuggestRequest("other@1", "담당", Values("{}")), Ct));
    }

    [Fact]
    public async Task Chooses_a_fields_threshold_from_its_history_once_it_is_long_enough()
    {
        var few = await Suggestions.BuildAsync(new VaultSnapshot([Intake],
            [.. Enumerable.Range(1, 5).Select(i => Document($"문서/{i}.md", $$"""{"요청": "노트북 배터리 문제 {{i}}", "담당": "장비"}"""))]), Ct);
        Assert.Null(few.Choice("intake@1", "담당")); // too short: the prior threshold serves

        var many = await Suggestions.BuildAsync(Many(15), Ct);
        Assert.True(many.NeedsSelection);
        Assert.Null(many.Choice("intake@1", "담당")); // chosen apart from building memory
        many.Apply(await many.SelectThresholdsAsync(Ct));
        Assert.False(many.NeedsSelection);
        var choice = many.Choice("intake@1", "담당");
        Assert.NotNull(choice);
        Assert.True(choice.Precision >= Suggestions.TargetPrecision);
        Assert.True(choice.Answered >= Suggestions.MinimumAnswered);

        // Rebuilt from the same vault, the field keeps its threshold rather than replaying again.
        var rebuilt = await Suggestions.BuildAsync(Many(15), Ct, previous: many);
        Assert.False(rebuilt.NeedsSelection);
        Assert.Equal(choice, rebuilt.Choice("intake@1", "담당"));
        Assert.True((await Suggestions.BuildAsync(Many(17), Ct, previous: many)).NeedsSelection); // grew by a tenth
    }

    private static VaultSnapshot Many(int count) => new([Intake],
        [.. Enumerable.Range(1, count).Select(i => new DocumentSnapshot($"문서/{i}.md", "intake@1",
            Values($$"""{"요청": "노트북 배터리 문제 {{i}}", "담당": "장비"}"""), Modified: i))]);

    [Fact]
    public async Task A_vault_ingest_chooses_thresholds_in_the_background()
    {
        var vault = new VaultProjection();
        await vault.IngestAsync(Many(15), Ct);
        await vault.ThresholdsSelected.WaitAsync(Ct);
        await vault.IngestAsync(Many(15), Ct);
        Assert.True(vault.ThresholdsSelected.IsCompleted); // nothing grew: no replay started
    }

    private static readonly DocumentSnapshot[] Confirmed =
    [
        Document("문서/1.md", """{"요청": "노트북 배터리가 금방 닳아요", "부서": "영업", "담당": "장비"}"""),
        Document("문서/2.md", """{"요청": "노트북 배터리가 금방 닳아요", "부서": "영업"}"""),
        Document("문서/3.md", """{"요청": "노트북 배터리가 금방 닳아요", "부서": "영업"}"""),
    ];

    private static SuggestionEvent Event(string at, string doc, string kind) => new(at, doc, "담당", kind, "장비");

    private static async Task<string?> SuggestedIn(VaultProjection vault, string document)
    {
        var suggestion = await vault.SuggestAsync(
            new SuggestRequest("intake@1", "담당", Values("""{"요청": "노트북 배터리가 금방 닳아요", "부서": "영업"}"""), document), Ct);
        return suggestion!.Value;
    }

    [Fact]
    public async Task Does_not_offer_again_what_was_rejected_in_a_document()
    {
        var vault = new VaultProjection();
        await vault.IngestAsync(new VaultSnapshot([Intake], Confirmed, [Event("2026-09-28T10:00:00.000Z", "문서/2.md", "reject")]), Ct);

        Assert.Null(await SuggestedIn(vault, "문서/2.md"));
        Assert.Equal("장비", await SuggestedIn(vault, "문서/3.md"));
        Assert.Equal("rejected", (await vault.SuggestAsync(
            new SuggestRequest("intake@1", "담당", Values("""{"요청": "노트북 배터리가 금방 닳아요"}"""), "문서/2.md"), Ct))!.Mode);
    }

    [Fact]
    public async Task A_later_confirmation_in_the_document_lifts_a_rejection()
    {
        var vault = new VaultProjection();
        await vault.IngestAsync(new VaultSnapshot([Intake], Confirmed,
        [
            Event("2026-09-28T11:00:00.000Z", "문서/2.md", "correct"),
            Event("2026-09-28T10:00:00.000Z", "문서/2.md", "reject"),
        ]), Ct);

        Assert.Equal("장비", await SuggestedIn(vault, "문서/2.md"));
    }
}
