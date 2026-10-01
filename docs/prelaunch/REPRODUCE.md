# REPRODUCE

Candidate: `c7aac17812c1b7708f3397638451533f423898315f558e5a864b04475f08e699`

解压后从交付根运行 node source/scripts/prelaunch-source-reproduce.mjs . <新的外部输出目录> <明确已有锁定依赖目录>。此入口核验完整source清单/sha/candidate及lockfile后，在新目录从源码generate与build四包，不调用git、不依赖原Mac路径、不连接DB或网络。它输出REPRODUCTION.json和原始日志；已有dependencies必须与交付lock一致。这是本地依赖复用复现，fresh frozen-lockfile安装及跨机器安装仍待验证。完整API/DB故障验证需要另建带owner/guard的synthetic runtime，禁止指向默认5432或原生产数据。



此报告不将总测试结果自动推导为业务验收；逐条结论见 COVERAGE_LEDGER.json 和 EVIDENCE_INDEX.json。

包内结构与hash校验：`python3 docs/prelaunch/tools/check_handoff.py --root /absolute/extracted/FANJU_PRELAUNCH_REVIEW`。此命令不证明业务、法务或上线验收。
