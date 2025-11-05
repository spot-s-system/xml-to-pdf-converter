/**
 * XML解析ユーティリティ
 * 被保険者名・事業主名などを抽出
 */

export interface InsuredPerson {
  name: string;
  xmlContent: string; // 個別のXMLコンテンツ（該当被保険者のみ）
}

export interface InsuredPersonWith7140001 extends InsuredPerson {
  revisionDate: string; // 改定年月（例: "R7年9月"）
}

/**
 * 7100001.xml (資格取得確認および標準報酬決定通知書) から被保険者名を抽出
 */
export function extractInsuredPersonsFrom7100001(
  xmlContent: string
): InsuredPerson[] {
  const persons: InsuredPerson[] = [];

  // <_被保険者> ... </_被保険者> のブロックを全て抽出
  const personRegex = /<_被保険者>([\s\S]*?)<\/_被保険者>/g;
  let match;

  while ((match = personRegex.exec(xmlContent)) !== null) {
    const personBlock = match[0];

    // 被保険者氏名を抽出（7100001では被保険者漢字氏名を使用）
    const nameMatch = personBlock.match(
      /<被保険者漢字氏名><!\[CDATA\[(.*?)\]\]><\/被保険者漢字氏名>/
    );

    if (nameMatch && nameMatch[1]) {
      const name = nameMatch[1].trim();

      // 個別のXMLを構築（ルート要素 + この被保険者のみ）
      const individualXml = `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="7100001.xsl"?>
<N7100001>
${personBlock}
<非表示項目>非表示項目</非表示項目>
</N7100001>`;

      persons.push({
        name,
        xmlContent: individualXml,
      });
    }
  }

  return persons;
}

/**
 * 7130001.xml (標準報酬決定通知書) から被保険者名を抽出
 */
export function extractInsuredPersonsFrom7130001(
  xmlContent: string
): InsuredPerson[] {
  const persons: InsuredPerson[] = [];

  // <_被保険者> ... </_被保険者> のブロックを全て抽出
  const personRegex = /<_被保険者>([\s\S]*?)<\/_被保険者>/g;
  let match;

  while ((match = personRegex.exec(xmlContent)) !== null) {
    const personBlock = match[0];

    // 被保険者氏名を抽出
    const nameMatch = personBlock.match(
      /<被保険者氏名><!\[CDATA\[(.*?)\]\]><\/被保険者氏名>/
    );

    if (nameMatch && nameMatch[1]) {
      const name = nameMatch[1].trim();

      // 個別のXMLを構築（ルート要素 + この被保険者のみ）
      const individualXml = `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="7130001.xsl"?>
<N7130001>
${personBlock}
<非表示項目>非表示項目</非表示項目>
</N7130001>`;

      persons.push({
        name,
        xmlContent: individualXml,
      });
    }
  }

  return persons;
}

/**
 * 7140001.xml (標準報酬改定通知書) から被保険者名と改定年月を抽出
 */
export function extractInsuredPersonsFrom7140001(
  xmlContent: string
): InsuredPersonWith7140001[] {
  const persons: InsuredPersonWith7140001[] = [];

  // <_被保険者> ... </_被保険者> のブロックを全て抽出
  const personRegex = /<_被保険者>([\s\S]*?)<\/_被保険者>/g;
  let match;

  while ((match = personRegex.exec(xmlContent)) !== null) {
    const personBlock = match[0];

    // 被保険者氏名を抽出
    const nameMatch = personBlock.match(
      /<被保険者氏名><!\[CDATA\[(.*?)\]\]><\/被保険者氏名>/
    );

    // 改定年月を抽出
    const eraMatch = personBlock.match(/<改定年月_元号>(.*?)<\/改定年月_元号>/);
    const yearMatch = personBlock.match(/<改定年月_年>(.*?)<\/改定年月_年>/);
    const monthMatch = personBlock.match(/<改定年月_月>(.*?)<\/改定年月_月>/);

    if (nameMatch && nameMatch[1] && eraMatch && yearMatch && monthMatch) {
      const name = nameMatch[1].trim();
      const era = eraMatch[1].trim();
      const year = parseInt(yearMatch[1].trim(), 10);
      const month = parseInt(monthMatch[1].trim(), 10);
      const revisionDate = `${era}${year}年${month}月`;

      // 個別のXMLを構築（ルート要素 + この被保険者のみ）
      const individualXml = `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="7140001.xsl"?>
<N7140001>
${personBlock}
<非表示項目>非表示項目</非表示項目>
</N7140001>`;

      persons.push({
        name,
        revisionDate,
        xmlContent: individualXml,
      });
    }
  }

  return persons;
}

/**
 * 7200001.xml (70歳以上被用者) から被保険者名を抽出
 */
export function extractInsuredPersonsFrom7200001(
  xmlContent: string
): InsuredPerson[] {
  const persons: InsuredPerson[] = [];

  // <_被保険者> ... </_被保険者> のブロックを全て抽出
  const personRegex = /<_被保険者>([\s\S]*?)<\/_被保険者>/g;
  let match;

  while ((match = personRegex.exec(xmlContent)) !== null) {
    const personBlock = match[0];

    // 被用者漢字氏名を抽出
    const nameMatch = personBlock.match(
      /<被用者漢字氏名><!\[CDATA\[(.*?)\]\]><\/被用者漢字氏名>/
    );

    if (nameMatch && nameMatch[1]) {
      const name = nameMatch[1].trim();

      // 個別のXMLを構築
      const individualXml = `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="7200001.xsl"?>
<N7200001>
${personBlock}
<非表示項目>非表示項目</非表示項目>
</N7200001>`;

      persons.push({
        name,
        xmlContent: individualXml,
      });
    }
  }

  return persons;
}

/**
 * henrei.xml (返戻票) から被保険者名を抽出
 */
export function extractInsuredPersonsFromHenrei(
  xmlContent: string
): InsuredPerson[] {
  const persons: InsuredPerson[] = [];

  // 返戻票も複数被保険者の可能性があるため、同様の処理
  const personRegex = /<_被保険者>([\s\S]*?)<\/_被保険者>/g;
  let match;

  while ((match = personRegex.exec(xmlContent)) !== null) {
    const personBlock = match[0];

    // 被保険者氏名を抽出（返戻票用のタグ名を確認が必要）
    let nameMatch = personBlock.match(
      /<被保険者氏名><!\[CDATA\[(.*?)\]\]><\/被保険者氏名>/
    );

    if (!nameMatch) {
      // 別のタグ名の可能性
      nameMatch = personBlock.match(
        /<氏名><!\[CDATA\[(.*?)\]\]><\/氏名>/
      );
    }

    if (nameMatch && nameMatch[1]) {
      const name = nameMatch[1].trim();

      const individualXml = `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="henrei.xsl"?>
<HENREI>
${personBlock}
</HENREI>`;

      persons.push({
        name,
        xmlContent: individualXml,
      });
    }
  }

  // 被保険者が抽出できなかった場合は、XML全体を1つとして扱う
  if (persons.length === 0) {
    persons.push({
      name: "返戻票",
      xmlContent,
    });
  }

  return persons;
}

/**
 * kagami.xml (表紙) から事業主名を抽出
 */
export function extractBusinessOwnerFromKagami(
  xmlContent: string
): string {
  // <NAME><![CDATA[...]]></NAME> から事業主氏名を抽出
  const nameMatch = xmlContent.match(
    /<NAME><!\[CDATA\[(.*?)\]\]><\/NAME>/
  );

  if (nameMatch && nameMatch[1]) {
    return nameMatch[1].trim();
  }

  return "表紙";
}

/**
 * ファイル名として使用できる文字列にサニタイズ
 */
export function sanitizeFileName(name: string): string {
  // ファイル名に使えない文字を置換
  // 全角スペースも削除
  return name
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/[\s　]+/g, "")  // 半角・全角スペース削除
    .trim();
}
