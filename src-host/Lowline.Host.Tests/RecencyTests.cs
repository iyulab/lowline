using System.Text.Json;

namespace Lowline.Host.Tests;

public sealed class RecencyTests
{
    private static readonly TemplateSnapshot Intake = new("intake@1",
    [
        new TemplateField("요청", "textarea"),
        new TemplateField("담당", "select"),
    ], Suggest: ["담당"]);

    private static IReadOnlyDictionary<string, JsonElement> Values(string json) =>
        JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(json)!;

    [Theory]
    [InlineData("문서/a.md", "문서/b.md")]
    [InlineData("문서/b.md", "문서/a.md")]
    public async Task The_latest_confirmation_of_the_same_case_wins(string olderPath, string newerPath)
    {
        var ct = TestContext.Current.CancellationToken;
        var older = new DocumentSnapshot(olderPath, "intake@1", Values("""{"요청": "프린터 토너가 떨어졌어요", "담당": "장비"}"""), Modified: 1_000);
        var newer = new DocumentSnapshot(newerPath, "intake@1", Values("""{"요청": "프린터 토너가 떨어졌어요", "담당": "총무"}"""), Modified: 2_000);
        await using var vault = new VaultProjection();
        await vault.IngestAsync(new VaultSnapshot([Intake], [older, newer]), ct);

        var suggestion = await vault.SuggestAsync(
            new SuggestRequest("intake@1", "담당", Values("""{"요청": "프린터 토너가 떨어졌어요"}""")), ct);

        Assert.Equal("총무", suggestion!.Value);
    }
}
