"""Publish a validated manual-install package; token stays in Actions environment."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import urllib.error
import urllib.parse
import urllib.request

ROOT=Path(__file__).resolve().parent.parent
API='https://api.github.com'
REPO='hao93/fn-dit'


def require(value,message):
    if not value:
        raise RuntimeError(message)


def request(method,url,data=None,binary=None,missing=False):
    require(urllib.parse.urlparse(url).hostname in ('api.github.com','uploads.github.com'),'Unexpected API host')
    token=os.environ.get('GITHUB_TOKEN')
    require(token,'GITHUB_TOKEN is required in the publishing job')
    headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json',
             'X-GitHub-Api-Version':'2026-03-10','User-Agent':'fn-dit-release'}
    if binary is not None:
        payload=binary;headers['Content-Type']='application/octet-stream'
    elif data is not None:
        payload=json.dumps(data,ensure_ascii=False).encode();headers['Content-Type']='application/json'
    else:
        payload=None
    req=urllib.request.Request(url,data=payload,headers=headers,method=method)
    try:
        with urllib.request.urlopen(req,timeout=120) as response:
            body=response.read()
            return json.loads(body) if body else None
    except urllib.error.HTTPError as error:
        if missing and error.code==404:
            return None
        # Never print request headers, environment or token values.
        raise RuntimeError(f'GitHub {method} {urllib.parse.urlparse(url).path}: HTTP {error.code}') from None


def endpoint(path):
    return f'{API}/repos/{REPO}/{path}'


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--dry-run',action='store_true')
    args=parser.parse_args()
    config=json.loads((ROOT/'.release/request.json').read_text())
    version=json.loads((ROOT/'package.json').read_text())['version']
    require(config=={'version':version,'unsigned':True,'channel':'manual-install'},'Release request must explicitly match unsigned manual-install version')
    require(re.fullmatch(r'\d+\.\d+\.\d+',version),'Invalid release version')
    sha=os.environ.get('GITHUB_SHA','')
    require(re.fullmatch(r'[0-9a-f]{40}',sha),'A concrete source commit is required')
    require(os.environ.get('GITHUB_REPOSITORY',REPO)==REPO,'Unexpected repository')
    dist=ROOT/'dist'
    package=dist/f'fn-dit-{version}-unsigned.fpk'
    audit=json.loads(Path(str(package)+'.audit.json').read_text())
    require(audit['version']==version and audit['sha256']==hashlib.sha256(package.read_bytes()).hexdigest(),'FPK audit mismatch')
    checksum=Path(str(package)+'.sha256')
    require(checksum.read_text().split()[0]==audit['sha256'],'FPK checksum mismatch')
    notes=(ROOT/f'docs/releases/v{version}.md').read_text()
    require('未签名' in notes and '未经' in notes,'Release notes must state signing and validation limits')
    shutil.copyfile(ROOT/'docs/QUICKSTART.md',dist/'INSTALL.zh-CN.md')
    provenance={'version':version,'source_commit':sha,'signed':False,'channel':'manual-install',
        'fnpack_version':'1.3.3','fnpack_linux_sha256':'1464d6aa9b995ebecb263c5ec60f0f4a7cbf45e0ce887836755fd65abd647d1e',
        'fpk_sha256':audit['sha256'],
        'validation':['Node.js regression tests','FPK corruption regression tests','packaged service lifecycle, history and schedule smoke tests','FPK structural audit'],
        'workflow_url':f'https://github.com/{REPO}/actions/runs/'+os.environ.get('GITHUB_RUN_ID','local')}
    (dist/'BUILD-INFO.json').write_text(json.dumps(provenance,ensure_ascii=False,indent=2)+'\n')
    assets=[package,checksum,Path(str(package)+'.audit.json'),dist/'INSTALL.zh-CN.md',dist/'BUILD-INFO.json']
    checksums=dist/'SHA256SUMS.txt'
    checksums.write_text(''.join(f'{hashlib.sha256(file.read_bytes()).hexdigest()}  {file.name}\n' for file in assets))
    assets.append(checksums)
    marker=f'<!-- fn-dit-release source={sha} -->'
    body=notes+'\n\n'+marker
    tag='v'+version
    if args.dry_run:
        print(json.dumps({'tag':tag,'source_commit':sha,'unsigned':True,'assets':[f.name for f in assets]},indent=2))
        return
    ref=request('GET',endpoint('git/ref/tags/'+tag),missing=True)
    if ref is None:
        request('POST',endpoint('git/refs'),{'ref':'refs/tags/'+tag,'sha':sha})
    else:
        target=ref['object']
        while target['type']=='tag':
            target=request('GET',endpoint('git/tags/'+target['sha']))['object']
        require(target['type']=='commit' and target['sha']==sha,'Existing tag points at a different commit; refusing to move it')
    release=request('GET',endpoint('releases/tags/'+tag),missing=True)
    if release:
        require(release['draft'] and marker in release.get('body',''),'Existing published or unrelated release will not be overwritten')
    else:
        release=request('POST',endpoint('releases'),{'tag_name':tag,'target_commitish':sha,
            'name':f'飞牛 DIT v{version} · 未签名手动安装版','body':body,'draft':True,'prerelease':False,'make_latest':'false'})
    expected={file.name:hashlib.sha256(file.read_bytes()).hexdigest() for file in assets}
    for asset in release['assets']:
        # Only replace artifacts owned by this un-published, same-source draft.
        require(asset['name'] in expected,'Unexpected draft asset; refusing to alter it')
        request('DELETE',endpoint('releases/assets/'+str(asset['id'])))
    upload=release['upload_url'].split('{',1)[0]
    for file in assets:
        result=request('POST',upload+'?name='+urllib.parse.quote(file.name),binary=file.read_bytes())
        require(result['state']=='uploaded' and result['size']==file.stat().st_size,'Asset upload incomplete')
        require(result.get('digest')=='sha256:'+expected[file.name],'Uploaded asset SHA-256 mismatch')
    check=request('GET',endpoint('releases/'+str(release['id'])))
    require({a['name'] for a in check['assets']}==set(expected),'Release asset set mismatch')
    require(all(a.get('digest')=='sha256:'+expected[a['name']] for a in check['assets']),'Release asset verification failed')
    published=request('PATCH',endpoint('releases/'+str(release['id'])),{'draft':False,'prerelease':False,'make_latest':'true','body':body})
    require(not published['draft'] and not published['prerelease'],'Release did not publish')
    latest=request('GET',endpoint('releases/latest'))
    require(latest['id']==published['id'],'Release was not selected as latest')
    print('Published '+published['html_url'])
    output=os.environ.get('GITHUB_STEP_SUMMARY')
    if output:
        with open(output,'a') as stream:
            stream.write(f'## Published {tag}\n\n{published["html_url"]}\n\nUnsigned manual-install build. All asset SHA-256 digests verified.\n')


if __name__=='__main__':
    main()
