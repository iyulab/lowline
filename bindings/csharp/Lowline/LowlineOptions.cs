namespace Lowline;

/// <summary>What a host's forms run on: the store their records are kept in, and the forms themselves.</summary>
public class LowlineOptions
{
    private readonly Dictionary<string, string> _forms = [];

    /// <summary>The store the settled records and the tuning are kept in.</summary>
    public ILowlineStore? Store { get; set; }

    /// <summary>The forms defined so far, by name.</summary>
    public IReadOnlyDictionary<string, string> Forms => _forms;

    /// <summary>Keeps the records in <paramref name="store"/>.</summary>
    public LowlineOptions UseStore(ILowlineStore store)
    {
        ArgumentNullException.ThrowIfNull(store);
        Store = store;
        return this;
    }

    /// <summary>Defines form <paramref name="name"/> — see <see cref="LowlineForms.Define"/>.</summary>
    public LowlineOptions Form(string name, string definitionJson)
    {
        ArgumentException.ThrowIfNullOrEmpty(name);
        ArgumentException.ThrowIfNullOrEmpty(definitionJson);
        _forms[name] = definitionJson;
        return this;
    }

    /// <summary>The forms these options describe, over their store.</summary>
    /// <exception cref="InvalidOperationException">No store was given.</exception>
    public LowlineForms Build(TimeProvider? time = null)
    {
        var forms = new LowlineForms(
            Store ?? throw new InvalidOperationException(
                "Lowline has no store to keep its records in: give one with UseStore, or UseSqlite from Lowline.Sqlite."),
            time);
        foreach (var (name, definition) in _forms)
        {
            forms.Define(name, definition);
        }

        return forms;
    }
}
