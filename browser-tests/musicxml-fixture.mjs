export function musicXmlFixture(measureCount = 8) {
 const parts = ['Soprano','Alto'];
 return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><work><work-title>练习乐谱</work-title></work><part-list>${parts.map((name,i)=>`<score-part id="P${i}"><part-name>${name}</part-name></score-part>`).join('')}</part-list>${parts.map((_,i)=>`<part id="P${i}">${Array.from({length:measureCount},(_,j)=>`<measure number="${j+1}">${j===0?'<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><direction><sound tempo="80"/></direction>':''}<note><pitch><step>${i?'C':'E'}</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure>`).join('')}</part>`).join('')}</score-partwise>`);
}

// A second voice in the same staff exercises alphaTab's secondary glyph color.
export function polyphonicMusicXmlFixture(measureCount = 8) {
 const xml = musicXmlFixture(measureCount).toString();
 const start = xml.indexOf('<part id="P1">');
 return Buffer.from(xml.slice(0, start) + xml.slice(start).replaceAll('</type></note>', '</type><voice>1</voice></note><backup><duration>4</duration></backup><note><pitch><step>G</step><octave>3</octave></pitch><duration>4</duration><type>whole</type><voice>2</voice></note>'));
}

// The last B-flat inherits its spelling without repeating the accidental glyph.
export function sourceSpellingMusicXmlFixture(measureCount = 8) {
 const notes = [['E',-1,4,true],['B',-1,3,true],['G',0,4,false],['B',-1,3,false]]
  .map(([step,alter,octave,explicit])=>`<note><pitch><step>${step}</step><alter>${alter}</alter><octave>${octave}</octave></pitch><duration>1</duration><type>quarter</type>${explicit?'<accidental>flat</accidental>':''}</note>`).join('');
 return Buffer.from(polyphonicMusicXmlFixture(measureCount).toString().replace(/<note>[\s\S]*?<\/note>/,notes));
}


// Owned modern graphic directions; no ornament or playback interpretation.
export function finiteBracketDirections() {
 return '<direction placement="above"><direction-type><bracket type="start" number="1" line-type="solid" line-end="down" default-y="10" end-length="65"/></direction-type><offset>0</offset></direction><direction placement="above"><direction-type><bracket type="stop" number="1" line-type="solid" line-end="down" default-y="10" end-length="65"/></direction-type><offset>2</offset></direction><direction placement="above"><direction-type><bracket type="start" number="2" line-type="solid" line-end="none" default-y="-55"/></direction-type><offset>0</offset></direction><direction placement="above"><direction-type><bracket type="stop" number="2" line-type="solid" line-end="none" default-y="-55"/></direction-type><offset>2</offset></direction><direction placement="above"><direction-type><bracket type="start" number="3" line-type="wavy" line-end="none" default-y="-20"/></direction-type><offset>2</offset></direction><direction placement="above"><direction-type><bracket type="stop" number="3" line-type="wavy" line-end="none" default-y="-20"/></direction-type><offset>3</offset></direction>';
}
