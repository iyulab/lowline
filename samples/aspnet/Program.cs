// A web host with a learning form: two pieces on the server (AddLowline, MapLowline), one element on the page.
//
//   cargo build -p lowline-ffi
//   (cd bindings/web && npm ci && npm run bundle)
//   dotnet run --project samples/aspnet
//
// Or, from the repository root: scripts/sample.sh
//
// The first run seeds forty records — Acme's owner kim, Beta's lee — so the owner is suggested at once. Filling from
// what a person wrote, and judging an owner the records cannot answer (a customer never seen), go through the engine's
// model over a chat client (Lowline.Extensions.AI). The chat client is a stand-in that answers as the page asks, or a
// local model server: set LOWLINE_SAMPLE_MODEL_URL (an OpenAI-compatible endpoint such as http://localhost:11434/v1)
// and LOWLINE_SAMPLE_MODEL. The page shows what the model's answers came to, from the counter the engine's model keeps.

using System.Text.Json.Nodes;

using Lowline;
using Lowline.Extensions.AI;
using Lowline.Sample;
using Microsoft.Extensions.AI;
using Lowline.Sqlite;
using Microsoft.Extensions.FileProviders;

const string Intake = """
    {
      "form": { "fields": [
        { "name": "customer", "kind": "text" },
        { "name": "owner", "kind": "choice", "choices": ["kim", "lee"] }
      ] }
    }
    """;

var builder = WebApplication.CreateSlimBuilder(args);
var database = Path.Combine(builder.Environment.ContentRootPath, "sample.db");
var standIn = new StandInChatClient();
IChatClient chat = Environment.GetEnvironmentVariable("LOWLINE_SAMPLE_MODEL_URL") is { Length: > 0 } url
    ? new ChatCompletionsClient(new Uri(url), Environment.GetEnvironmentVariable("LOWLINE_SAMPLE_MODEL") ?? "")
    : standIn;
var health = new ModelHealth();
builder.Services.AddLowline(o => o.UseSqlite($"Data Source={database}").UseChatClient(chat).Form("intake", Intake));

var app = builder.Build();
app.UseDefaultFiles();
app.UseStaticFiles();
// The element, as `npm run bundle` built it in this repository.
var bundle = Path.GetFullPath(Path.Combine(builder.Environment.ContentRootPath, "..", "..", "bindings", "web", "dist", "bundle"));
app.UseStaticFiles(new StaticFileOptions { FileProvider = new PhysicalFileProvider(bundle), RequestPath = "/element" });
app.MapLowline("/lowline");

// The sample's own: what the model's answers came to, and — with the stand-in — how it answers.
app.MapGet("/sample/model", () => Results.Text(Model().ToJsonString(), "application/json"));
app.MapPost("/sample/model", async (HttpRequest request) =>
{
    var asked = await JsonNode.ParseAsync(request.Body);
    if (chat != standIn || !Enum.TryParse<StandInAnswer>((string?)asked?["answer"], ignoreCase: true, out var answer))
    {
        return Results.BadRequest();
    }

    standIn.Answer = answer;
    return Results.Text(Model().ToJsonString(), "application/json");
});

JsonObject Model()
{
    var model = health.Read();
    model["standIn"] = chat == standIn;
    model["answer"] = chat == standIn ? standIn.Answer.ToString() : null;
    return model;
}

await Seed(app.Services.GetRequiredService<LowlineWebOptions>().Store!);
app.Run();

static async Task Seed(ILowlineStore store)
{
    var scope = new LowlineScope("intake", "default");
    if ((await store.ReadRecordsAsync(scope)).Count > 0)
    {
        return;
    }

    using var engine = LowlineEngine.Create($$"""{ "name": "intake", {{Intake.Trim()[1..]}}""");
    var start = DateTimeOffset.UtcNow.AddDays(-1);
    for (var i = 0; i < 40; i++)
    {
        var saved = new Dictionary<string, FieldValue>
        {
            ["customer"] = i % 2 == 0 ? "Acme" : "Beta",
            ["owner"] = i % 2 == 0 ? "kim" : "lee",
        };
        await store.AddRecordAsync(scope, engine.Settle($"seed-{i}", saved, null, SettledBy.Person, start.AddMinutes(i)));
    }
}
