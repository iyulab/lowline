namespace Lowline.Host;

/// <summary>
/// One point of a correction curve: after the <see cref="N"/>th decision about a field's
/// suggestions, the share of the latest ones (up to <see cref="Curves.Window"/>) that were right.
/// </summary>
public sealed record CurvePoint(int N, string At, double Rate);

/// <summary>
/// How a judgment field's suggestions have fared: every decision people made about them, in order.
/// A suggestion was right when it was accepted as offered; corrected or rejected, it was not.
/// </summary>
public sealed record FieldCurve(
    string Template, string Field, int Accepted, int Corrected, int Rejected, IReadOnlyList<CurvePoint> Points,
    FieldReplay? Replay = null);

/// <summary>
/// How a field's suggestions did when its saved documents were replayed in the order they were saved, each asked
/// of the ones before it, at the similarity threshold the replay chose: <see cref="AnswerRate"/> of the lookups
/// got a suggestion, and <see cref="Precision"/> of those were right. Unlike the curve, which counts only
/// suggestions that were made, this says how often none was.
/// </summary>
public sealed record FieldReplay(double Threshold, double Precision, double AnswerRate, int Answered, int Lookups);

/// <summary>
/// Correction curves from the vault's event files — whether suggestions get better with use.
/// Only decisions count: a suggestion never offered (nothing close enough was remembered) leaves no event.
/// </summary>
public static class Curves
{
    /// <summary>How many of the latest decisions each point's rate is taken over.</summary>
    public const int Window = 10;

    public static IReadOnlyList<FieldCurve> Compute(VaultSnapshot vault)
    {
        var templateOf = vault.Documents.ToDictionary(d => d.Path, d => d.Template, StringComparer.Ordinal);
        var judged = vault.Templates.ToDictionary(t => t.Ref, t => t.Suggest ?? [], StringComparer.Ordinal);
        return (vault.Events ?? [])
            // An event names its template; older ones are placed through their document, if it is still there.
            .Select(e => (Event: e, Template: e.Template ?? templateOf.GetValueOrDefault(e.Doc)))
            .Where(x => x.Template is not null
                && judged.TryGetValue(x.Template, out var fields) && fields.Contains(x.Event.Field))
            .GroupBy(x => (Template: x.Template!, x.Event.Field))
            .OrderBy(g => g.Key.Template, StringComparer.Ordinal)
            .ThenBy(g => Array.IndexOf(judged[g.Key.Template].ToArray(), g.Key.Field))
            .Select(g => Curve(g.Key.Template, g.Key.Field, g.Select(x => x.Event)))
            .ToList();
    }

    private static FieldCurve Curve(string template, string field, IEnumerable<SuggestionEvent> events)
    {
        var ordered = events.OrderBy(e => e.At, StringComparer.Ordinal).ToList();
        var points = new List<CurvePoint>(ordered.Count);
        for (var i = 0; i < ordered.Count; i++)
        {
            var from = Math.Max(0, i + 1 - Window);
            var latest = ordered.Skip(from).Take(i + 1 - from).ToList();
            points.Add(new CurvePoint(i + 1, ordered[i].At, (double)latest.Count(e => e.Kind == "accept") / latest.Count));
        }
        return new FieldCurve(
            template,
            field,
            ordered.Count(e => e.Kind == "accept"),
            ordered.Count(e => e.Kind == "correct"),
            ordered.Count(e => e.Kind == "reject"),
            points);
    }
}
