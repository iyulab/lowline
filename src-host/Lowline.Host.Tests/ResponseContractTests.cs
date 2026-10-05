using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.DependencyInjection;

namespace Lowline.Host.Tests;

/// <summary>
/// What the sidecar answers the UI, as it goes over HTTP, written to <c>src/__tests__/sidecar-responses.json</c>:
/// the UI's own test reads that file and fails on a field its types do not know, or one they need that is not
/// there — the shell passes these answers through untouched, and the UI's types vanish at run time, so a renamed
/// field would otherwise read as empty. Numbers are written as 0: what is pinned is the shape and the words the UI
/// branches on, not what a replay happens to measure. A change here fails until the file is written again with
/// <c>LOWLINE_UPDATE_CONTRACT=1</c> — and then the UI's test says whether the UI still reads it.
/// </summary>
public sealed class ResponseContractTests
{
    private static readonly JsonSerializerOptions Written = new(JsonSerializerOptions.Web)
    {
        WriteIndented = true,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    private static readonly TemplateSnapshot Intake = new("intake@1",
    [
        new TemplateField("요청", "textarea"),
        new TemplateField("부서", "select", Options: ["영업", "개발"]),
        new TemplateField("수량", "number"),
        new TemplateField("담당", "select", Options: ["장비", "총무"]),
        new TemplateField("긴급", "select", Options: ["높음", "낮음"]),
    ], Suggest: ["담당", "긴급"]);

    // Two requests name a monitor, one twice: searching for it, and for what is like the first, finds one best each
    // — documents that score the same come back in the order they were indexed, which is not what is pinned here.
    private static readonly Dictionary<int, string> Requests = new() { [2] = "모니터가 깜빡여요 모니터 교체", [3] = "모니터가 깜빡여요" };

    private static DocumentSnapshot Document(int i) => new($"문서/{i}.md", "intake@1",
        JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(
            $$"""{"요청": "{{Requests.GetValueOrDefault(i, $"노트북 배터리 {i}")}}", "부서": "영업", "수량": {{(i == 1 ? "\"여러 개\"" : "1")}}, "담당": "장비", "긴급": "{{(i % 2 == 0 ? "높음" : "낮음")}}"}""")!,
        Modified: i);

    // Fault codes the machine decides nine times in ten, with five fields that say nothing about them: the replay
    // rests 고장 on 설비 alone, so a curve carries the fields its suggestions rest on.
    private static readonly string[] Noise = ["교대", "라인", "등급", "지역", "공정"];

    private static readonly TemplateSnapshot Faults = new("faults@1",
        [.. Noise.Select(n => new TemplateField(n, "select")), new TemplateField("설비", "select"), new TemplateField("고장", "text")],
        Suggest: ["고장"]);

    private static IEnumerable<DocumentSnapshot> FaultReports()
    {
        var random = new Random(7);
        for (var i = 0; i < 300; i++)
        {
            var values = Noise.ToDictionary(n => n, n => (object)$"{n}{random.Next(6)}");
            var machine = random.Next(30);
            values["설비"] = $"설비{machine}";
            values["고장"] = random.NextDouble() < 0.9 ? $"F{machine:D2}" : $"F{random.Next(90):D2}";
            yield return new DocumentSnapshot($"고장/{i:D3}.md", "faults@1",
                JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(JsonSerializer.Serialize(values))!, Modified: 100 + i);
        }
    }

    private static SuggestionEvent Event(int minute, string kind) =>
        new($"2026-10-03T10:{minute:00}:00.000Z", "문서/1.md", "담당", kind, "장비", "intake@1", "key");

    private static string FixturePath([CallerFilePath] string here = "") =>
        Path.GetFullPath(Path.Combine(Path.GetDirectoryName(here)!, "..", "..", "src", "__tests__", "sidecar-responses.json"));

    [Fact]
    public async Task What_the_sidecar_answers_is_the_file_the_UI_checks_its_types_against()
    {
        var ct = TestContext.Current.CancellationToken;
        await using var factory = new HostTests.Factory();
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", HostTests.Token);

        async Task<JsonNode> Post(string path, object body)
        {
            var response = await client.PostAsJsonAsync(path, body, JsonSerializerOptions.Web, ct);
            response.EnsureSuccessStatusCode();
            return JsonNode.Parse(await response.Content.ReadAsStringAsync(ct))!;
        }

        // Fifteen documents that settle 담당 by 부서 and split 긴급 evenly; one with a 수량 that is not a number, one
        // of a template the vault does not have, and a suggestion for 담당 turned down on the first document.
        var snapshot = new VaultSnapshot(
            [Intake, Faults],
            [.. Enumerable.Range(1, 15).Select(Document), .. FaultReports(), new DocumentSnapshot("문서/옛.md", "gone@1", new Dictionary<string, JsonElement>())],
            [Event(0, "accept"), Event(1, "correct"), Event(2, "reject")]);
        var ingest = await Post("/vault/ingest", snapshot);
        await factory.Services.GetRequiredService<VaultProjection>().ThresholdsSelected.WaitAsync(ct);

        var observed = new Dictionary<string, object> { ["부서"] = "영업" };
        var responses = new JsonObject
        {
            ["ingest"] = ingest,
            ["projection"] = await Post("/projection", new ProjectionQuery("intake@1", [new ColumnFilter("부서", "contains", "영업")])),
            ["curves"] = JsonNode.Parse(await client.GetStringAsync("/curves", ct)),
            ["suggestions"] = new JsonArray(
                await Post("/suggest", new { template = "intake@1", field = "담당", values = observed }),
                await Post("/suggest", new { template = "intake@1", field = "긴급", values = observed }),
                await Post("/suggest", new { template = "intake@1", field = "담당", values = observed, document = "문서/1.md" })),
            ["search"] = await Post("/search", new CaseQuery("모니터", Max: 1)),
            ["similar"] = await Post("/similar", new SimilarQuery("문서/3.md", Max: 1)),
            // The words the UI branches on, every one the sidecar can send — not only those this vault happens to draw.
            ["words"] = new JsonObject
            {
                ["mode"] = Words(typeof(SuggestionMode)),
                ["reason"] = Words(typeof(Abstention)),
                ["whyNoReplay"] = Words(typeof(NoReplay), Abstention.BelowTarget),
            },
        };
        var written = Zeroed(responses)!.ToJsonString(Written).ReplaceLineEndings("\n") + "\n";

        // Written into the source tree; checked against the copy the build puts beside the tests.
        if (Environment.GetEnvironmentVariable("LOWLINE_UPDATE_CONTRACT") == "1")
        {
            File.WriteAllText(FixturePath(), written);
            return;
        }
        var path = Path.Combine(AppContext.BaseDirectory, "sidecar-responses.json");
        Assert.True(File.Exists(path), $"{path} is missing; write it with LOWLINE_UPDATE_CONTRACT=1");
        Assert.True(File.ReadAllText(path) == written,
            "The sidecar's answers changed. Write the file again with LOWLINE_UPDATE_CONTRACT=1, then run the UI's tests: " +
            "src/__tests__/response-contract.test.ts says whether the UI still reads them.");
    }

    private static JsonArray Words(Type of, params string[] more) =>
        [.. of.GetFields(BindingFlags.Public | BindingFlags.Static).Where(f => f.IsLiteral).Select(f => (string)f.GetRawConstantValue()!)
            .Concat(more).Select(w => JsonValue.Create(w))];

    /// <summary>The same answers with every number 0.</summary>
    private static JsonNode? Zeroed(JsonNode? node) => node switch
    {
        JsonObject o => new JsonObject(o.Select(p => KeyValuePair.Create(p.Key, Zeroed(p.Value)))),
        JsonArray a => new JsonArray([.. a.Select(Zeroed)]),
        JsonValue v when v.GetValueKind() == JsonValueKind.Number => JsonValue.Create(0),
        _ => node?.DeepClone(),
    };
}
