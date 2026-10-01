using System.Text.Json;

namespace Lowline.Host.Tests;

public sealed class SuggestionsTests
{
    private static readonly TemplateSnapshot Intake = new("intake@1",
    [
        new TemplateField("요청", "textarea"),
        new TemplateField("부서", "text"),
        new TemplateField("담당", "select"),
    ], Suggest: ["담당"]);

    private static IReadOnlyDictionary<string, JsonElement> Values(string json) =>
        JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(json)!;

    private static DocumentSnapshot Document(string path, string json) => new(path, "intake@1", Values(json));

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static async Task<VaultProjection> Vault(params DocumentSnapshot[] documents)
    {
        var vault = new VaultProjection();
        await vault.IngestAsync(new VaultSnapshot([Intake], documents), Ct);
        return vault;
    }

    [Fact]
    public async Task Suggests_the_value_confirmed_for_a_similar_document()
    {
        await using var vault = await Vault(
            Document("문서/1.md", """{"요청": "노트북 배터리가 금방 닳아요", "부서": "영업", "담당": "장비"}"""),
            Document("문서/2.md", """{"요청": "급여 명세서를 다시 받고 싶어요", "부서": "개발", "담당": "인사"}"""));

        var suggestion = await vault.SuggestAsync(
            new SuggestRequest("intake@1", "담당", Values("""{"요청": "노트북 배터리가 금방 닳아요!", "부서": "기획"}""")), Ct);

        Assert.NotNull(suggestion);
        Assert.Equal("장비", suggestion.Value);
        Assert.Equal("memory", suggestion.Mode);
        Assert.Equal("문서/1.md", suggestion.Source);
        Assert.True(suggestion.Similarity >= Suggestions.PriorThreshold);
        Assert.True(vault.MemoryReady);
    }

    [Fact]
    public async Task Shows_the_similar_documents_behind_a_suggestion_with_the_values_they_confirmed()
    {
        // A month at a small desk: twelve requests, each asked three times over.
        (string Request, string Owner)[] requests =
        [
            ("노트북 배터리가 금방 닳아요", "장비"), ("노트북 화면에 줄이 생겨요", "장비"), ("노트북 충전이 안 돼요", "장비"),
            ("휴가 일수를 확인하고 싶어요", "인사"), ("휴가 신청을 취소하고 싶어요", "인사"), ("휴가 이월이 되나요", "인사"),
            ("회의실 예약이 안 돼요", "총무"), ("회의실 에어컨이 고장났어요", "총무"), ("회의실 의자가 부족해요", "총무"),
        ];
        var documents = Enumerable.Range(0, 3).SelectMany(round => requests.Select((r, i) => Document(
            $"문서/{round}-{i}.md",
            JsonSerializer.Serialize(new Dictionary<string, string> { ["요청"] = round == 0 ? r.Request : $"{r.Request} ({round + 1}차)", ["부서"] = "영업", ["담당"] = r.Owner }))));
        await using var vault = await Vault([.. documents]);

        var suggestion = await vault.SuggestAsync(
            new SuggestRequest("intake@1", "담당", Values("""{"요청": "회의실 에어컨이 고장났어요", "부서": "영업"}""")), Ct);

        Assert.True(suggestion is { Mode: "memory" }, $"{suggestion}");
        var similar = Assert.IsAssignableFrom<IReadOnlyList<SimilarCase>>(suggestion.Similar);
        Assert.True(similar.Count is > 1 and <= Suggestions.SimilarCount, string.Join(", ", similar));
        // The suggestion's own source first, closest first, each with the value it confirmed.
        Assert.Equal(suggestion.Source, similar[0].Source);
        Assert.Equal(suggestion.Value, similar[0].Value);
        Assert.Equal(similar.OrderByDescending(c => c.Similarity), similar);
        // Only as close as the bar the offered value passed.
        Assert.All(similar, c => Assert.True(c.Similarity >= Suggestions.PriorThreshold, $"{c}"));
    }

    [Fact]
    public async Task Does_not_offer_a_value_only_another_fields_value_backs()
    {
        // 인사 was confirmed with 부서 개발, but the request itself resembles nothing confirmed.
        await using var vault = await Vault(
            Document("문서/1.md", """{"요청": "노트북 배터리가 금방 닳아요", "부서": "영업", "담당": "장비"}"""),
            Document("문서/2.md", """{"요청": "급여 명세서를 다시 받고 싶어요", "부서": "개발", "담당": "인사"}"""));

        var suggestion = await vault.SuggestAsync(
            new SuggestRequest("intake@1", "담당", Values("""{"요청": "회의실 예약 방법이 궁금합니다", "부서": "개발"}""")), Ct);

        Assert.Equal(new Suggestion(null, "abstain", null, null, Abstention.NoneClose), suggestion);
    }

    [Fact]
    public async Task Does_not_offer_a_value_nothing_in_the_document_backs()
    {
        // 장비 is the field's most frequent value, but nothing in this document points to it.
        await using var vault = await Vault(
            Document("문서/1.md", """{"요청": "노트북 배터리가 금방 닳아요", "부서": "영업", "담당": "장비"}"""),
            Document("문서/2.md", """{"요청": "모니터가 깜빡여요", "부서": "영업", "담당": "장비"}"""));

        var suggestion = await vault.SuggestAsync(
            new SuggestRequest("intake@1", "담당", Values("""{"요청": "회의실 예약 방법이 궁금합니다", "부서": "총무"}""")), Ct);

        Assert.Equal(new Suggestion(null, "abstain", null, null, Abstention.NoneClose), suggestion);
    }

    [Fact]
    public async Task A_document_is_not_its_own_similar_document()
    {
        await using var vault = await Vault(Document("문서/1.md", """{"요청": "노트북 배터리가 금방 닳아요", "담당": "장비"}"""));

        var suggestion = await vault.SuggestAsync(
            new SuggestRequest("intake@1", "담당", Values("""{"요청": "노트북 배터리가 금방 닳아요!"}"""), "문서/1.md"), Ct);

        Assert.Null(suggestion!.Value);
    }

    [Fact]
    public async Task Does_not_learn_from_a_document_with_a_conflict_copy()
    {
        // A sync client kept both devices' edits: which values hold is not settled yet.
        await using var vault = await Vault(
            Document("문서/1.md", """{"요청": "노트북 배터리가 금방 닳아요", "담당": "장비"}""") with { Conflicted = true });

        var suggestion = await vault.SuggestAsync(
            new SuggestRequest("intake@1", "담당", Values("""{"요청": "노트북 배터리가 금방 닳아요!"}""")), Ct);
        var table = await vault.TableAsync("intake@1", Ct);

        Assert.Equal(new Suggestion(null, "abstain", null, null, Abstention.NoHistory), suggestion);
        Assert.Equal("문서/1.md", Assert.Single(table!.Rows).Path);
    }

    [Fact]
    public async Task Abstains_when_nothing_confirmed_is_close_enough()
    {
        await using var vault = await Vault(Document("문서/1.md", """{"요청": "노트북 배터리가 금방 닳아요", "담당": "장비"}"""));

        var suggestion = await vault.SuggestAsync(
            new SuggestRequest("intake@1", "담당", Values("""{"요청": "회의실 예약 방법이 궁금합니다"}""")), Ct);

        Assert.Equal(new Suggestion(null, "abstain", null, null, Abstention.NoneClose), suggestion);
    }

    [Fact]
    public async Task Abstains_on_an_empty_document_and_with_an_empty_memory()
    {
        await using var empty = await Vault();
        var none = await empty.SuggestAsync(new SuggestRequest("intake@1", "담당", Values("""{"요청": "무엇이든"}""")), Ct);
        Assert.Null(none!.Value);

        await using var vault = await Vault(Document("문서/1.md", """{"요청": "배터리", "담당": "장비"}"""));
        var blank = await vault.SuggestAsync(new SuggestRequest("intake@1", "담당", Values("{}")), Ct);
        Assert.Equal(new Suggestion(null, "abstain", null, null, Abstention.NoneClose), blank);
    }

    [Fact]
    public async Task Offers_nothing_for_a_field_the_author_did_not_turn_suggestions_on_for()
    {
        await using var vault = await Vault(Document("문서/1.md", """{"요청": "배터리", "부서": "영업", "담당": "장비"}"""));
        Assert.Null(await vault.SuggestAsync(new SuggestRequest("intake@1", "부서", Values("""{"요청": "배터리"}""")), Ct));
        Assert.Null(await vault.SuggestAsync(new SuggestRequest("other@1", "담당", Values("{}")), Ct));
    }

    [Fact]
    public async Task Chooses_a_fields_threshold_from_its_history_once_it_is_long_enough()
    {
        var few = await Suggestions.BuildAsync(new VaultSnapshot([Intake],
            [.. Enumerable.Range(1, 5).Select(i => Document($"문서/{i}.md", $$"""{"요청": "노트북 배터리 문제 {{i}}", "담당": "장비"}"""))]), Ct);
        Assert.Null(few.Choice("intake@1", "담당")); // too short: the prior threshold serves

        var many = await Suggestions.BuildAsync(Many(15), Ct);
        Assert.True(many.NeedsSelection);
        Assert.Null(many.Choice("intake@1", "담당")); // chosen apart from building memory
        many.Apply(await many.SelectThresholdsAsync(Ct));
        Assert.False(many.NeedsSelection);
        var choice = many.Choice("intake@1", "담당");
        Assert.NotNull(choice);
        Assert.True(choice.Precision >= Suggestions.TargetPrecision);
        Assert.True(choice.Answered >= Suggestions.MinimumAnswered);

        // Rebuilt from the same vault, the field keeps its threshold rather than replaying again.
        var rebuilt = await Suggestions.BuildAsync(Many(15), Ct, previous: many);
        Assert.False(rebuilt.NeedsSelection);
        Assert.Equal(choice, rebuilt.Choice("intake@1", "담당"));
        Assert.True((await Suggestions.BuildAsync(Many(17), Ct, previous: many)).NeedsSelection); // grew by a tenth
    }

    [Fact]
    public async Task Answers_from_a_field_that_decides_it_once_its_history_shows_it_does()
    {
        // 부서 decides 담당 here, while no two requests are alike.
        string[] words = ["사과", "기차", "구름", "연필", "바다", "시계", "우산", "나무", "모자", "종이"];
        var owners = new Dictionary<string, string> { ["영업"] = "장비", ["개발"] = "인사", ["인사"] = "총무" };
        var departments = owners.Keys.ToArray();
        var vault = new VaultSnapshot([Intake],
            [.. Enumerable.Range(0, 30).Select(i => new DocumentSnapshot($"문서/{i}.md", "intake@1",
                Values($$"""{"요청": "{{words[i % 10]}} {{words[i / 10 * 3 % 10]}} {{i}}", "부서": "{{departments[i % 3]}}", "담당": "{{owners[departments[i % 3]]}}"}"""),
                Modified: i))]);
        var suggestions = await Suggestions.BuildAsync(vault, Ct);
        var request = new SuggestRequest("intake@1", "담당", Values("""{"요청": "전혀 다른 요청", "부서": "개발"}"""));

        // Until replay shows 부서 decides it, a value settled alongside it is only a guess.
        Assert.Equal(new Suggestion(null, "abstain", null, null, Abstention.NoneClose), await suggestions.SuggestAsync(request, Ct));

        suggestions.Apply(await suggestions.SelectThresholdsAsync(Ct));
        Assert.Equal(new Suggestion("인사", "key", "부서: 개발", null), await suggestions.SuggestAsync(request, Ct));
    }

    [Fact]
    public async Task Says_a_field_its_replay_held_back_apart_from_one_nothing_is_close_to()
    {
        // Alike requests, owners alternating: the nearest earlier document is wrong half the time, at any similarity.
        var vault = new VaultSnapshot([Intake],
            [.. Enumerable.Range(1, 15).Select(i => new DocumentSnapshot($"문서/{i}.md", "intake@1",
                Values($$"""{"요청": "노트북 배터리 문제 {{i}}", "담당": "{{(i % 2 == 0 ? "장비" : "인사")}}"}"""), Modified: i))]);
        var suggestions = await Suggestions.BuildAsync(vault, Ct);
        Assert.Equal(NoReplay.Pending, suggestions.WhyNoReplay("intake@1", "담당"));

        suggestions.Apply(await suggestions.SelectThresholdsAsync(Ct));
        Assert.Null(suggestions.Choice("intake@1", "담당"));
        Assert.Equal(Abstention.BelowTarget, suggestions.WhyNoReplay("intake@1", "담당"));
        var suggestion = await suggestions.SuggestAsync(
            new SuggestRequest("intake@1", "담당", Values("""{"요청": "노트북 배터리 문제 16"}""")), Ct);
        Assert.Equal(new Suggestion(null, "abstain", null, null, Abstention.BelowTarget), suggestion);
        // How close it came: right about half the time at best, short of the target.
        var closest = suggestions.Closest("intake@1", "담당");
        Assert.NotNull(closest);
        Assert.InRange(closest.Precision, 0.3, 0.7);
        Assert.True(closest.Precision < Suggestions.TargetPrecision);
    }

    [Fact]
    public async Task Says_why_a_field_has_no_replay_yet()
    {
        var empty = await Suggestions.BuildAsync(new VaultSnapshot([Intake], []), Ct);
        Assert.Equal(NoReplay.Few, empty.WhyNoReplay("intake@1", "담당"));

        var few = await Suggestions.BuildAsync(Many(5), Ct);
        few.Apply(await few.SelectThresholdsAsync(Ct));
        Assert.Equal(NoReplay.Few, few.WhyNoReplay("intake@1", "담당"));

        var many = await Suggestions.BuildAsync(Many(15), Ct);
        Assert.Equal(NoReplay.Pending, many.WhyNoReplay("intake@1", "담당"));
        many.Apply(await many.SelectThresholdsAsync(Ct));
        Assert.Null(many.WhyNoReplay("intake@1", "담당"));
        Assert.Null(many.WhyNoReplay("intake@1", "부서")); // not a judgment field
    }

    private static VaultSnapshot Many(int count) => new([Intake],
        [.. Enumerable.Range(1, count).Select(i => new DocumentSnapshot($"문서/{i}.md", "intake@1",
            Values($$"""{"요청": "노트북 배터리 문제 {{i}}", "담당": "장비"}"""), Modified: i))]);

    [Fact]
    public async Task A_vault_ingest_chooses_thresholds_in_the_background()
    {
        await using var vault = new VaultProjection();
        await vault.IngestAsync(Many(15), Ct);
        await vault.ThresholdsSelected.WaitAsync(Ct);
        await vault.IngestAsync(Many(15), Ct);
        Assert.True(vault.ThresholdsSelected.IsCompleted); // nothing grew: no replay started
    }

    [Fact]
    public async Task Asking_teaches_nothing()
    {
        // Only saved documents teach. A request carrying a value for the judgment field — an unsaved
        // draft that already holds one — must not become something later requests are answered from.
        await using var vault = await Vault(Document("문서/1.md", """{"요청": "노트북 배터리가 금방 닳아요", "담당": "장비"}"""));
        await vault.SuggestAsync(
            new SuggestRequest("intake@1", "담당", Values("""{"요청": "사내 동호회 가입 신청서 양식", "담당": "총무"}"""), "문서/2.md"), Ct);

        var later = await vault.SuggestAsync(
            new SuggestRequest("intake@1", "담당", Values("""{"요청": "사내 동호회 가입 신청서 양식!"}""")), Ct);

        Assert.Equal(new Suggestion(null, "abstain", null, null, Abstention.NoneClose), later);
    }

    private static readonly DocumentSnapshot[] Confirmed =
    [
        Document("문서/1.md", """{"요청": "노트북 배터리가 금방 닳아요", "부서": "영업", "담당": "장비"}"""),
        Document("문서/2.md", """{"요청": "노트북 배터리가 금방 닳아요", "부서": "영업"}"""),
        Document("문서/3.md", """{"요청": "노트북 배터리가 금방 닳아요", "부서": "영업"}"""),
    ];

    private static SuggestionEvent Event(string at, string doc, string kind) => new(at, doc, "담당", kind, "장비");

    private static async Task<string?> SuggestedIn(VaultProjection vault, string document)
    {
        var suggestion = await vault.SuggestAsync(
            new SuggestRequest("intake@1", "담당", Values("""{"요청": "노트북 배터리가 금방 닳아요", "부서": "영업"}"""), document), Ct);
        return suggestion!.Value;
    }

    [Fact]
    public async Task Does_not_offer_again_what_was_rejected_in_a_document()
    {
        await using var vault = new VaultProjection();
        await vault.IngestAsync(new VaultSnapshot([Intake], Confirmed, [Event("2026-09-28T10:00:00.000Z", "문서/2.md", "reject")]), Ct);

        Assert.Null(await SuggestedIn(vault, "문서/2.md"));
        Assert.Equal("장비", await SuggestedIn(vault, "문서/3.md"));
        Assert.Equal("rejected", (await vault.SuggestAsync(
            new SuggestRequest("intake@1", "담당", Values("""{"요청": "노트북 배터리가 금방 닳아요"}"""), "문서/2.md"), Ct))!.Mode);
    }

    [Fact]
    public async Task A_later_confirmation_in_the_document_lifts_a_rejection()
    {
        await using var vault = new VaultProjection();
        await vault.IngestAsync(new VaultSnapshot([Intake], Confirmed,
        [
            Event("2026-09-28T11:00:00.000Z", "문서/2.md", "correct"),
            Event("2026-09-28T10:00:00.000Z", "문서/2.md", "reject"),
        ]), Ct);

        Assert.Equal("장비", await SuggestedIn(vault, "문서/2.md"));
    }

    [Fact]
    public async Task A_document_is_known_by_its_id_wherever_its_file_is()
    {
        // The rejection was recorded when the file was 문서/2.md; it has been renamed since.
        var renamed = Confirmed.Select(d => d.Path == "문서/2.md" ? d with { Path = "문서/새 이름.md", Id = "doc-2" } : d).ToArray();
        await using var vault = new VaultProjection();
        await vault.IngestAsync(new VaultSnapshot([Intake], renamed, [Event("2026-09-28T10:00:00.000Z", "doc-2", "reject")]), Ct);

        Assert.Null(await SuggestedIn(vault, "doc-2"));
        var fromSimilar = await vault.SuggestAsync(
            new SuggestRequest("intake@1", "담당", Values("""{"요청": "노트북 배터리가 금방 닳아요", "부서": "영업"}"""), "doc-9"), Ct);
        Assert.Equal("memory", fromSimilar!.Mode);
        Assert.Contains(fromSimilar.Source, new[] { "문서/1.md", "doc-2", "문서/3.md" });
    }

    [Fact]
    public async Task A_value_that_backs_another_about_one_time_in_three_does_not_answer_for_it()
    {
        // Support requests written from a few stock sentences, so settled documents repeat one another and
        // answer each other right by their own requests. 채널 전화 leans to 배송 but backs it only about a third of
        // the time, and 제품 backs nothing: neither may answer 분류 for a request unlike any settled one, however
        // well the repeats did on the replay.
        var support = new TemplateSnapshot("support@1",
        [
            new TemplateField("문의", "textarea"),
            new TemplateField("채널", "select"),
            new TemplateField("제품", "select"),
            new TemplateField("분류", "select"),
        ], Suggest: ["분류"]);
        var sentences = new Dictionary<string, string[]>
        {
            ["고장"] = ["정수기에서 물이 새요", "전원이 들어오지 않아요", "소음이 심해졌어요"],
            ["배송"] = ["주문한 제품이 아직 안 왔어요", "배송 조회가 안 돼요", "다른 주소로 받고 싶어요"],
            ["환불"] = ["환불 받고 싶어요", "결제가 두 번 됐어요", "반품 접수는 어떻게 하나요"],
            ["설치"] = ["설치 기사 방문 일정을 잡고 싶어요", "벽걸이로 달 수 있나요", "이사 후 재설치 문의"],
        };
        var kinds = sentences.Keys.ToArray();
        string[] products = ["정수기", "공기청정기", "비데"];
        var random = new Random(586);
        var vault = new VaultSnapshot([support],
            [.. Enumerable.Range(0, 200).Select(i =>
            {
                var kind = kinds[random.Next(kinds.Length)];
                var phone = random.NextDouble() < (kind == "배송" ? 0.6 : 0.25);
                var channel = phone ? "전화" : random.Next(2) == 0 ? "채팅" : "이메일";
                var json = $$"""{"문의": "{{sentences[kind][random.Next(3)]}}", "채널": "{{channel}}", "제품": "{{products[random.Next(3)]}}", "분류": "{{kind}}"}""";
                return new DocumentSnapshot($"문서/{i:D3}.md", "support@1", Values(json), Modified: i);
            })]);
        var byPhone = vault.Documents.Where(d => d.Values["채널"].GetString() == "전화").ToList();
        var deliveryShare = (double)byPhone.Count(d => d.Values["분류"].GetString() == "배송") / byPhone.Count;
        Assert.InRange(deliveryShare, 0.25, 0.45); // the lean the case is about, measured on the data itself
        Assert.Equal("배송", byPhone.GroupBy(d => d.Values["분류"].GetString()).MaxBy(g => g.Count())!.Key);

        var suggestions = await Suggestions.BuildAsync(vault, Ct);
        suggestions.Apply(await suggestions.SelectThresholdsAsync(Ct));

        var suggestion = await suggestions.SuggestAsync(new SuggestRequest("support@1", "분류",
            Values("""{"문의": "정수기에서 물이 조금씩 흘러나와요", "채널": "전화", "제품": "정수기"}""")), Ct);
        Assert.NotNull(suggestion);
        Assert.NotEqual("key", suggestion.Mode);
        Assert.NotEqual("배송", suggestion.Value);
    }
}
