namespace Lowline;

/// <summary>What a host's forms run on: the store their records are kept in, and the forms themselves.</summary>
public class LowlineOptions
{
    private readonly Dictionary<string, string> _forms = [];

    /// <summary>The store the settled records and the tuning are kept in.</summary>
    public ILowlineStore? Store { get; set; }

    /// <summary>The host's model, which fills a form from what a person wrote; filling is off without one.</summary>
    public ILowlineModel? Model { get; set; }

    /// <summary>The forms defined so far, by name.</summary>
    public IReadOnlyDictionary<string, string> Forms => _forms;

    /// <summary>Keeps the records in <paramref name="store"/>.</summary>
    public LowlineOptions UseStore(ILowlineStore store)
    {
        ArgumentNullException.ThrowIfNull(store);
        Store = store;
        return this;
    }

    /// <summary>Fills forms from what a person wrote through <paramref name="model"/>.</summary>
    public LowlineOptions UseModel(ILowlineModel model)
    {
        ArgumentNullException.ThrowIfNull(model);
        Model = model;
        return this;
    }

    /// <summary>Defines form <paramref name="name"/> — see <see cref="LowlineForms.Define"/>. A definition the engine
    /// refuses is refused here, so a host whose forms do not resolve fails as it starts.</summary>
    /// <exception cref="ArgumentException">The definition is not a JSON object, or the engine refuses it.</exception>
    public LowlineOptions Form(string name, string definitionJson)
    {
        ArgumentException.ThrowIfNullOrEmpty(name);
        ArgumentException.ThrowIfNullOrEmpty(definitionJson);
        _forms[name] = LowlineForms.Checked(name, definitionJson);
        return this;
    }

    /// <summary>The forms these options describe, over their store.</summary>
    /// <exception cref="InvalidOperationException">No store was given.</exception>
    public LowlineForms Build(TimeProvider? time = null)
    {
        var forms = new LowlineForms(
            Store ?? throw new InvalidOperationException(
                "Lowline has no store to keep its records in: give one with UseStore, or UseSqlite from Lowline.Sqlite."),
            time,
            Model);
        foreach (var (name, definition) in _forms)
        {
            forms.Define(name, definition);
        }

        return forms;
    }
}
