namespace Lowline.Host;

/// <summary>
/// One point of a correction curve: after the <see cref="N"/>th decision about a field's
/// suggestions, the share of the latest ones (up to <see cref="Curves.Window"/>) that were right.
/// </summary>
public sealed record CurvePoint(int N, string At, double Rate);

/// <summary>
/// How a judgment field's suggestions have fared: every decision people made about them, in order.
/// A suggestion was right when it was accepted as offered; corrected or rejected, it was not.
/// Without a <see cref="Replay"/>, <see cref="WhyNoReplay"/> says why (see <see cref="Suggestions.WhyNoReplay"/>), and
/// when the replay fell short of the target, <see cref="Closest"/> says by how much. <see cref="BySource"/> splits the
/// decisions by where each suggestion came from: each source promises the target on its own replay, so each is
/// read against it apart.
/// </summary>
public sealed record FieldCurve(
    string Template, string Field, int Accepted, int Corrected, int Rejected, IReadOnlyList<CurvePoint> Points,
    FieldReplay? Replay = null, string? WhyNoReplay = null, FieldShortfall? Closest = null,
    IReadOnlyList<SourceCount>? BySource = null);

/// <summary>Of a field's decisions about suggestions from one source, how many there were and how many were accepted.</summary>
public sealed record SourceCount(string Source, int Decided, int Accepted);

/// <summary>
/// How close a field's replay came when no threshold was right often enough: at the most precise threshold that still
/// gathered enough answers, <see cref="Precision"/> of its answers were right, against the <see cref="Target"/>. That
/// precision can reach the target and the field still not be offered, when a band of answers within it falls short.
/// </summary>
public sealed record FieldShortfall(double Precision, double AnswerRate, int Answered, int Lookups, double Target);

/// <summary>
/// How a field's suggestions did when its saved documents were replayed in the order they were saved, each asked
/// of the ones before it, at the strength the replay chose for values settled alongside the observed ones: <see cref="AnswerRate"/> of the lookups
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

    /// <summary>
    /// A curve for every judgment field of every template, in the templates' order and each template's own —
    /// a field nothing has been decided about yet has one with no points, so its replay still has a place.
    /// </summary>
    public static IReadOnlyList<FieldCurve> Compute(VaultSnapshot vault)
    {
        // A copied file carries its original's id: either names the template.
        var templateOf = vault.Documents
            .GroupBy(d => d.Identity, StringComparer.Ordinal)
            .ToDictionary(g => g.Key, g => g.First().Template, StringComparer.Ordinal);
        // An event names its template; older ones are placed through their document, if it is still there.
        var decided = (vault.Events ?? [])
            .Select(e => (Event: e, Template: e.Template ?? templateOf.GetValueOrDefault(e.Doc)))
            .Where(x => x.Template is not null)
            .ToLookup(x => (Template: x.Template!, x.Event.Field), x => x.Event);
        return vault.Templates
            .SelectMany(t => (t.Suggest ?? []).Distinct(StringComparer.Ordinal).Select(field => (t.Ref, Field: field)))
            .Select(f => Curve(f.Ref, f.Field, decided[(f.Ref, f.Field)]))
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
            points,
            BySource: ordered
                .Where(e => e.Source is not null)
                .GroupBy(e => e.Source!, StringComparer.Ordinal)
                .OrderBy(g => g.Key, StringComparer.Ordinal)
                .Select(g => new SourceCount(g.Key, g.Count(), g.Count(e => e.Kind == "accept")))
                .ToList());
    }
}
