using System.Text.Json;

namespace Lowline.Host.Tests;

public sealed class CurvesTests
{
    private static readonly TemplateSnapshot Intake = new("intake@1",
    [
        new TemplateField("요청", "textarea"),
        new TemplateField("담당", "select"),
        new TemplateField("긴급", "select"),
    ], Suggest: ["담당", "긴급"]);

    private static DocumentSnapshot Document(string path) =>
        new(path, "intake@1", new Dictionary<string, JsonElement>());

    private static SuggestionEvent Event(int minute, string doc, string field, string kind, string? template = null) =>
        new($"2026-09-29T10:{minute:00}:00.000Z", doc, field, kind, "장비", template);

    [Fact]
    public void Takes_each_rate_over_the_latest_decisions_in_order()
    {
        var kinds = new[] { "reject", "correct", "accept", "accept" };
        var events = kinds.Select((k, i) => Event(i, "문서/1.md", "담당", k)).Reverse().ToList();

        var curve = Assert.Single(Curves.Compute(new VaultSnapshot([Intake], [Document("문서/1.md")], events)));

        Assert.Equal(("intake@1", "담당", 2, 1, 1), (curve.Template, curve.Field, curve.Accepted, curve.Corrected, curve.Rejected));
        Assert.Equal([0.0, 0.0, 1 / 3.0, 0.5], curve.Points.Select(p => p.Rate));
        Assert.Equal([1, 2, 3, 4], curve.Points.Select(p => p.N));
    }

    [Fact]
    public void Forgets_decisions_older_than_the_window()
    {
        var events = Enumerable.Range(0, Curves.Window)
            .Select(i => Event(i, "문서/1.md", "담당", "reject"))
            .Append(Event(Curves.Window, "문서/1.md", "담당", "accept"))
            .Append(Event(Curves.Window + 1, "문서/1.md", "담당", "accept"))
            .ToList();

        var curve = Assert.Single(Curves.Compute(new VaultSnapshot([Intake], [Document("문서/1.md")], events)));

        Assert.Equal(2.0 / Curves.Window, curve.Points[^1].Rate, 6);
    }

    [Fact]
    public void Places_an_event_by_its_template_even_when_its_document_is_gone_and_ignores_other_fields()
    {
        var events = new List<SuggestionEvent>
        {
            Event(0, "문서/옛이름.md", "담당", "accept", template: "intake@1"),
            Event(1, "문서/사라짐.md", "담당", "accept"),
            Event(2, "문서/1.md", "요청", "accept"),
            Event(3, "문서/1.md", "긴급", "correct"),
        };

        var curves = Curves.Compute(new VaultSnapshot([Intake], [Document("문서/1.md")], events));

        Assert.Equal([("담당", 1), ("긴급", 1)], curves.Select(c => (c.Field, c.Points.Count)));
    }
}
