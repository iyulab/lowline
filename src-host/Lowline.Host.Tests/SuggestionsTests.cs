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
            new SuggestRequest("intake@1", "담당", Values("""{"요청": "노트북 배터리가 금방 닳아요", "부서": "영업"}""")), Ct);

        Assert.NotNull(suggestion);
        Assert.Equal("장비", suggestion.Value);
        Assert.Equal("memory", suggestion.Mode);
        Assert.Equal("문서/1.md", suggestion.Source);
        Assert.True(suggestion.Similarity >= Suggestions.MemoryThreshold);
        Assert.True(vault.MemoryReady);
    }

    [Fact]
    public async Task Abstains_when_nothing_confirmed_is_close_enough()
    {
        var vault = await Vault(Document("문서/1.md", """{"요청": "노트북 배터리가 금방 닳아요", "담당": "장비"}"""));

        var suggestion = await vault.SuggestAsync(
            new SuggestRequest("intake@1", "담당", Values("""{"요청": "회의실 예약 방법이 궁금합니다"}""")), Ct);

        Assert.Equal(new Suggestion(null, "abstain", null, suggestion!.Similarity), suggestion);
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
    public void The_request_is_the_other_filled_fields_in_template_order() =>
        Assert.Equal("요청: 배터리\n부서: 영업",
            Suggestions.Request(Intake, "담당", Values("""{"부서": "영업", "담당": "장비", "요청": "배터리"}""")));

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
