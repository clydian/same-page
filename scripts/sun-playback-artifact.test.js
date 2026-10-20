import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, test } from 'vitest';
const before='vendor/clydian-chorus-player-0.1.19-samepage.3.tgz';
const after='vendor/clydian-chorus-player-0.1.19-samepage.4.tgz';
const native='vendor/coderline-alphatab-1.8.4-samepage.5.tgz';
const content=(file,name)=>execFileSync('tar',['-xOf',file,name]);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const members=file=>execFileSync('tar',['-tzf',file],{encoding:'utf8'}).trim().split('\n').filter(n=>n.endsWith('.js'));
function shape(node){
 if(ts.isParenthesizedExpression(node))return shape(node.expression);
 const children=[];ts.forEachChild(node,child=>{children.push(shape(child));});
 const literal=ts.isIdentifier(node)||ts.isLiteralExpression(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node);
 const semantic=ts.isVariableDeclarationList(node)?['declarationFlags',node.flags&(ts.NodeFlags.BlockScoped|ts.NodeFlags.Using|ts.NodeFlags.AwaitUsing)]:ts.isPrefixUnaryExpression(node)||ts.isPostfixUnaryExpression(node)?['operator',node.operator]:[];
 return [node.kind,...semantic,...(literal?[node.text]:[]),...children];
}
const tree=bytes=>shape(ts.createSourceFile('runtime.js',bytes.toString(),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS));
test('new player preserves all deployed runtime logic except the bounded piano role alias',()=>{
 expect(members(after)).toEqual(members(before));
 for(const name of members(before)){
  const old=content(before,name),now=content(after,name);
  if(name==='package/dist/piano-shared-attacks.js'){
   const expected=old.toString().replace(String.raw`/(?:\bpiano\b|\bpianoforte\b|钢琴)/iu`,String.raw`/(?:\bpiano\b|\bpianoforte\b|钢琴|^\s*keyboard\s+reduction(?:\s+\(for\s+rehearsal\s+only\))?\s*$)/iu`);
   expect(expected).not.toBe(old.toString());expect(now.toString()).toBe(expected);
  }else expect(tree(now),name).toEqual(tree(old));
 }
});
test('native package/source identities and MPL notices bind the exact shared peer',()=>{
 const manifest=JSON.parse(readFileSync('vendor/alphatab-1.8.4-samepage.5.manifest.json'));
 const previous=JSON.parse(readFileSync('vendor/alphatab-1.8.4-samepage.4.manifest.json'));
 const player=JSON.parse(content(after,'package/package.json'));
 const pkg=JSON.parse(content(native,'package/package.json'));
 const wrapper=JSON.parse(readFileSync('vendor/chorus-player-0.1.19-samepage.4.manifest.json'));
 expect(hash(readFileSync(native))).toBe(manifest.artifactSha256);
 expect(hash(readFileSync(after))).toBe(wrapper.playerSha256);
 expect(player.peerDependencies['@coderline/alphatab']).toBe(pkg.version);
 expect(pkg.version).toBe('1.8.4-samepage.5');
 expect(pkg.samePageSource.sourceCommit).toBe('6fb2eac48b8d98518c12f220e4a851b7b4594fed');
 expect(hash(content(native,'package/'+manifest.sourceArchive))).toBe(manifest.sourceSha256);
 expect(content(native,'package/LICENSE').toString()).toContain('Mozilla Public License');
 expect(content(native,'package/LICENSE.header').length).toBeGreaterThan(0);
 const changed=Object.keys(manifest.modifiedSource).filter(p=>previous.modifiedSource[p]!==manifest.modifiedSource[p]).sort();
 expect(changed).toEqual(['packages/alphatab/src/importer/MusicXmlImporter.ts','packages/alphatab/src/model/Note.ts','packages/alphatab/src/model/Score.ts','packages/alphatab/src/rendering/glyphs/SourceWedgesGlyph.ts','packages/alphatab/test/importer/MusicXmlReverseTies.test.ts']);
 const audio='packages/alphatab/src/platform/javascript/AlphaSynthAudioWorkletOutput.ts';
 expect(manifest.modifiedSource[audio]).toBe(previous.modifiedSource[audio]);
});
