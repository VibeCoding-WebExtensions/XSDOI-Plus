#!/usr/bin/env python3
"""校验 CI 打出来的 crx。

用法：python3 .github/verify-crx.py <crx 路径> <期望的 manifest 版本>

检查四件事：
  1. 文件确实是 CRX3
  2. 包内 manifest.json 的 version 与期望一致
  3. **包内嵌的公钥**推出的扩展 ID == EXPECTED_ID（这是「secret 里放的就是本仓库那把私钥」的唯一硬证据）
  4. 没混进 .git / .github 之类不该进包的条目

放 .github/ 下是故意的：Chrome 的打包器会跳过点开头的目录，这个脚本不会被塞进 crx。
"""
import hashlib
import json
import struct
import sys
import zipfile

EXPECTED_ID = 'nbcjlcfddbmniidbmpbpagdcpaeoofec'


def pubkey_from_crx3(raw):
    """从 CRX3 头部取 sha256_with_rsa.public_key（手写极简 protobuf 走查，不引第三方库）。"""
    assert raw[:4] == b'Cr24', '文件头不是 Cr24，不是 CRX'
    version = struct.unpack('<I', raw[4:8])[0]
    hlen = struct.unpack('<I', raw[8:12])[0]
    if version != 3:
        raise AssertionError(f'只支持 CRX3，实际版本 {version}')
    hdr = raw[12:12 + hlen]
    pub = None
    i = 0
    while i < len(hdr):
        tag = hdr[i]
        i += 1
        field, wire = tag >> 3, tag & 7
        if wire == 2:                      # length-delimited
            ln = 0
            shift = 0
            while True:
                b = hdr[i]
                i += 1
                ln |= (b & 0x7f) << shift
                shift += 7
                if not b & 0x80:
                    break
            val = hdr[i:i + ln]
            i += ln
            if field == 2:                 # signed_header_data.sha256_with_rsa
                j = 0
                while j < len(val):
                    t2 = val[j]
                    j += 1
                    f2, w2 = t2 >> 3, t2 & 7
                    if w2 == 2:
                        l2 = 0
                        s2 = 0
                        while True:
                            b = val[j]
                            j += 1
                            l2 |= (b & 0x7f) << s2
                            s2 += 7
                            if not b & 0x80:
                                break
                        v2 = val[j:j + l2]
                        j += l2
                        if f2 == 1:            # public_key
                            pub = v2
                    elif w2 == 0:              # varint
                        while val[j] & 0x80:
                            j += 1
                        j += 1
                    else:
                        break
        elif wire == 0:                    # varint
            while hdr[i] & 0x80:
                i += 1
            i += 1
        else:
            break
    assert pub, 'CRX 头部里没找到公钥'
    return pub


def ext_id_from_pubkey(pub):
    hexdigest = hashlib.sha256(pub).hexdigest()[:32]
    return ''.join(chr(ord('a') + int(c, 16)) for c in hexdigest)


def main():
    if len(sys.argv) < 3:
        print('用法: verify-crx.py <crx> <期望版本>')
        return 2
    crx_path, want_version = sys.argv[1], sys.argv[2]
    with open(crx_path, 'rb') as fh:
        raw = fh.read()

    pub = pubkey_from_crx3(raw)
    ext_id = ext_id_from_pubkey(pub)

    with zipfile.ZipFile(crx_path) as z:
        names = z.namelist()
        manifest = json.loads(z.read('manifest.json').decode('utf-8'))

    print(f'文件大小      : {len(raw)} 字节')
    print(f'公钥长度      : {len(pub)} 字节')
    print(f'扩展 ID       : {ext_id}')
    print(f'manifest 版本 : {manifest["version"]}')
    print(f'包内条目      : {len(names)} 个')

    assert manifest['version'] == want_version, \
        f'包内版本 {manifest["version"]} != manifest 期望的 {want_version}'
    assert ext_id == EXPECTED_ID, (
        f'扩展 ID 是 {ext_id}，期望 {EXPECTED_ID} —— '
        '说明 secret CRX_PRIVATE_KEY 里放的不是本仓库那把私钥（或放错了格式），打出来的包会变成另一个扩展'
    )
    assert any(n.startswith('content/') for n in names), '包内没有 content/ 目录'
    leaked = [n for n in names if n.startswith(('.git/', '.github/'))]
    assert not leaked, f'包内混进了不该有的条目: {leaked[:5]}'

    print('校验通过：扩展 ID 与私钥一致，版本一致，无多余条目')
    return 0


if __name__ == '__main__':
    sys.exit(main())
