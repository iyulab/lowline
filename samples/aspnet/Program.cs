// A web host with a learning form: two pieces on the server (AddLowline, MapLowline), one element on the page.
//
//   cargo build -p lowline-ffi
//   (cd bindings/web && npm ci && npm run bundle)
//   dotnet run --project samples/aspnet
//
// The first run seeds forty records — Acme's owner kim, Beta's lee — so the owner is suggested at once. Filling from
// what a person wrote goes through a stand-in for a real model (WordModel, below): a host gives its own.

using System.Text.RegularExpressions;

using Lowline;
using Lowline.AspNetCore;
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
builder.Services.AddLowline(o => o.UseSqlite($"Data Source={database}").UseModel(new WordModel()).Form("intake", Intake));

var app = builder.Build();
app.UseDefaultFiles();
app.UseStaticFiles();
// The element, as `npm run bundle` built it in this repository.
var bundle = Path.GetFullPath(Path.Combine(builder.Environment.ContentRootPath, "..", "..", "bindings", "web", "dist", "bundle"));
app.UseStaticFiles(new StaticFileOptions { FileProvider = new PhysicalFileProvider(bundle), RequestPath = "/element" });
app.MapLowline("/lowline");

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

/// <summary>A stand-in for a real model: for each field it is asked about, the word written after the field's name —
/// "customer Beta, owner lee". Whatever it gives is checked against its field before anyone sees it.</summary>
sealed partial class WordModel : ILowlineModel
{
    public Task<IReadOnlyDictionary<string, FieldValue>> FillAsync(
        LowlineFillRequest request, CancellationToken cancellationToken = default)
    {
        var answered = new Dictionary<string, FieldValue>();
        foreach (var field in request.Fields)
        {
            var found = Regex.Match(request.Text, $@"\b{Regex.Escape(field.Name)}\s*[:=]?\s*(\w+)", RegexOptions.IgnoreCase);
            if (found.Success)
            {
                answered[field.Name] = found.Groups[1].Value;
            }
        }

        return Task.FromResult<IReadOnlyDictionary<string, FieldValue>>(answered);
    }
}
