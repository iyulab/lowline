using Lowline;

// The native library loads, answers, and settles a save; the two other packages restore beside it.
using var engine = LowlineEngine.Create("""
    { "name": "smoke", "form": { "fields": [
      { "name": "customer", "kind": "text" },
      { "name": "owner", "kind": "choice", "choices": ["kim", "lee"] }
    ] } }
    """);
if (engine.Settled != 0)
{
    throw new InvalidOperationException($"a new engine has learned {engine.Settled} records");
}

Console.WriteLine($"Lowline {typeof(LowlineEngine).Assembly.GetName().Version} on {System.Runtime.InteropServices.RuntimeInformation.RuntimeIdentifier}: loaded");
_ = typeof(Lowline.Sqlite.SqliteLowlineStore);
_ = typeof(Lowline.AspNetCore.LowlineEndpoints);
