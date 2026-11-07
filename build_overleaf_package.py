#!/usr/bin/env python3
import os
import re
import subprocess
import zipfile

OVERLEAF_DIR = "ai_benchmarking/overleaf"
DOCS_DIR = "ai_benchmarking/docs"
INPUT_MD = os.path.join(DOCS_DIR, "publication_draft_06.md")

os.makedirs(os.path.join(OVERLEAF_DIR, "figures"), exist_ok=True)

# 1. Generate references.bib
BIB_CONTENT = """@article{jones2023tidyproteomics,
  author = {Jones, Jeffrey and MacKrell, E. J. and Wang, T. Y. and Lomenick, B. and Roukes, M. L. and Chou, T.-F.},
  title = {Tidyproteomics: an open-source {R} package and data object for quantitative proteomics post analysis and visualization},
  journal = {BMC Bioinformatics},
  year = {2023},
  volume = {24},
  number = {1},
  pages = {237},
  doi = {10.1186/s12859-023-05360-7}
}

@article{aebersold2016mass,
  author = {Aebersold, Ruedi and Mann, Matthias},
  title = {Mass-spectrometric exploration of proteome structure and function},
  journal = {Nature},
  year = {2016},
  volume = {537},
  number = {7620},
  pages = {347--355},
  doi = {10.1038/nature19949}
}

@article{cox2008maxquant,
  author = {Cox, J{\\"u}rgen and Mann, Matthias},
  title = {{MaxQuant} enables high peptide identification rates, individualized p.p.b.-range mass accuracies and proteome-wide protein quantification},
  journal = {Nature Biotechnology},
  year = {2008},
  volume = {26},
  number = {12},
  pages = {1367--1372},
  doi = {10.1038/nbt.1511}
}

@article{demichev2020diann,
  author = {Demichev, Vadim and Messner, Christoph B. and Vernardis, Spyros I. and Lilley, Kathryn S. and Ralser, Markus},
  title = {{DIA-NN}: neural networks and interference correction enable deep proteome coverage in high throughput},
  journal = {Nature Methods},
  year = {2020},
  volume = {17},
  number = {1},
  pages = {41--44},
  doi = {10.1038/s41592-019-0638-x}
}

@article{nesvizhskii2014proteomics,
  author = {Nesvizhskii, Alexey I.},
  title = {Proteomics modeling, computation, and analysis: Overview and perspectives},
  journal = {Bioinformatics},
  year = {2014},
  volume = {30},
  number = {24},
  pages = {i1--i2},
  doi = {10.1093/bioinformatics/btu649}
}

@article{wang2019deep,
  author = {Wang, Dongxue and Eraslan, Bilge and Wieland, Thomas and Hallstr{\\"o}m, Bj{\\"o}rn and Hopf, Thomas and Zolg, Daniel Paul and others},
  title = {A deep proteome and transcriptome abundance atlas of 29 healthy human tissues},
  journal = {Molecular Systems Biology},
  year = {2019},
  volume = {15},
  number = {2},
  pages = {e8503},
  doi = {10.15252/msb.20188503}
}

@article{karpievitch2012normalization,
  author = {Karpievitch, Yuliya V. and Dabney, Alan R. and Smith, Richard D.},
  title = {Normalization and missing value imputation for label-free {LC-MS} analysis},
  journal = {Bioinformatics},
  year = {2012},
  volume = {28},
  number = {10},
  pages = {1352--1360},
  doi = {10.1093/bioinformatics/bts150}
}

@article{lazar2016accounting,
  author = {Lazar, Cosmin and Gatto, Laurent and Ferro, Myriam and Bruley, Christophe and Burger, Thomas},
  title = {Accounting for the multiple natures of missing values in label-free quantitative proteomics data sets to compare imputation strategies},
  journal = {Journal of Proteome Research},
  year = {2016},
  volume = {15},
  number = {4},
  pages = {1116--1125},
  doi = {10.1021/acs.jproteome.5b00981}
}

@article{wei2018missing,
  author = {Wei, Runmin and Wang, Jialing and Su, Mingming and Jia, Eric and Chen, Shuai and Chen, Tianlu and others},
  title = {Missing value imputation approach for mass spectrometry-based metabolomics and proteomics data},
  journal = {Scientific Reports},
  year = {2018},
  volume = {8},
  number = {1},
  pages = {663},
  doi = {10.1038/s41598-017-19120-0}
}

@article{willforss2019normalyzerde,
  author = {Willforss, Jakob and Chawade, Aakash and Levander, Fredrik},
  title = {{NormalyzerDE}: Online tool for improved normalization of omics expression data and high-sensitivity differential expression analysis},
  journal = {Journal of Proteome Research},
  year = {2019},
  volume = {18},
  number = {2},
  pages = {732--740},
  doi = {10.1021/acs.jproteome.8b00523}
}

@article{ritchie2015limma,
  author = {Ritchie, Matthew E. and Phipson, Belinda and Wu, Di and Hu, Yifang and Law, Charity W. and Shi, Wei and others},
  title = {limma powers differential expression analyses for {RNA}-sequencing and microarray studies},
  journal = {Nucleic Acids Research},
  year = {2015},
  volume = {43},
  number = {7},
  pages = {e47},
  doi = {10.1093/nar/gkv007}
}

@article{korotkevich2021fgsea,
  author = {Korotkevich, Gennady and Sukhov, Vladimir and Budin, Nikolay and Shpak, Boris and Artyomov, Maxim N. and Sergushichev, Alexey},
  title = {Fast gene set enrichment analysis},
  journal = {bioRxiv},
  year = {2021},
  doi = {10.1101/060012}
}

@article{tyanova2016perseus,
  author = {Tyanova, Stefka and Temu, Tikira and Sinitcyn, Pavel and Carlson, Arthur and Hein, Marco Y. and Geiger, Tamar and others},
  title = {The {Perseus} computational platform for comprehensive analysis of (prote)omics data},
  journal = {Nature Methods},
  year = {2016},
  volume = {13},
  number = {9},
  pages = {731--740},
  doi = {10.1038/nmeth.3901}
}

@article{peng2011reproducible,
  author = {Peng, Roger D.},
  title = {Reproducible research in computational science},
  journal = {Science},
  year = {2011},
  volume = {334},
  number = {6060},
  pages = {1226--1227},
  doi = {10.1126/science.1213847}
}

@article{choi2014msstats,
  author = {Choi, Meena and Chang, Ching-Yun and Clough, Timothy and Broudy, Daniel and Killeen, Trevor and MacLean, Brendan and others},
  title = {{MSstats}: an {R} package for statistical analysis of quantitative mass spectrometry-based proteomic experiments},
  journal = {Bioinformatics},
  year = {2014},
  volume = {30},
  number = {17},
  pages = {2524--2526},
  doi = {10.1093/bioinformatics/btu305}
}

@article{zhang2018proteomewide,
  author = {Zhang, X. and Smits, A. H. and van Tilburg, G. B. A. and Jansen, P. W. T. C. and Makowski, M. M. and Ovaa, H. and others},
  title = {Proteome-wide identification of ubiquitin interactions using {UbIA-MS}},
  journal = {Nature Protocols},
  year = {2018},
  volume = {13},
  number = {3},
  pages = {530--550},
  doi = {10.1038/nprot.2017.147}
}

@article{wickham2019welcome,
  author = {Wickham, Hadley and Averick, Mara and Bryan, Jennifer and Chang, Winston and McGowan, Lucy D'Agostino and Fran{\c{c}}ois, Romain and others},
  title = {Welcome to the {Tidyverse}},
  journal = {Journal of Open Source Software},
  year = {2019},
  volume = {4},
  number = {43},
  pages = {1686},
  doi = {10.21105/joss.01686}
}

@misc{altmetric2024tidyproteomics,
  author = {{Altmetric}},
  title = {Altmetric Details for 10.1186/s12859-023-05360-7},
  howpublished = {Digital Science},
  year = {2024},
  note = {Available from: \\url{https://link.altmetric.com/details/149678760} [Accessed 2 Nov 2025]}
}

@article{gatto2014assessing,
  author = {Gatto, Laurent and Breckels, Lisa M. and Lilley, Kathryn S.},
  title = {Assessing sub-cellular resolution in spatial proteomics experiments},
  journal = {Current Opinion in Chemical Biology},
  year = {2014},
  volume = {24},
  pages = {121--129},
  doi = {10.1016/j.cbpa.2014.11.006}
}

@article{mangul2019systematic,
  author = {Mangul, Serghei and Martin, Lana S. and Hill, Brian L. and Couch, Angela M. and Oakhill, Jonathan S. and Wu, Peter and others},
  title = {Systematic benchmarking of omics computational tools},
  journal = {Nature Communications},
  year = {2010},
  volume = {10},
  number = {1},
  pages = {1393},
  doi = {10.1038/s41467-019-09406-4}
}

@article{batut2018community,
  author = {Batut, B{\\'e}r{\\'e}nice and Hiltemann, Saskia and Bagnacani, Andrea and Baker, Dave and Bhardwaj, Vivek and Blank, Clemens and others},
  title = {Community-driven data analysis training for biology},
  journal = {Cell Systems},
  year = {2018},
  volume = {6},
  number = {6},
  pages = {752--758},
  doi = {10.1016/cels.2018.05.012}
}

@article{singhal2023large,
  author = {Singhal, Karan and Azizi, Shekoofeh and Tu, Tao and Mahdavi, S. Sara and Wei, Jason and Chung, Hyung Won and others},
  title = {Large language models encode clinical knowledge},
  journal = {Nature},
  year = {2023},
  volume = {620},
  number = {7972},
  pages = {172--180},
  doi = {10.1038/s41586-023-06291-2}
}

@article{moor2023foundation,
  author = {Moor, Michael and Banerjee, Oishi and Abad, Zahra Shakeri Hossein and Krumholz, Harlan M. and Leskovec, Jure and Topol, Eric J. and others},
  title = {Foundation models for generalist medical artificial intelligence},
  journal = {Nature},
  year = {2023},
  volume = {616},
  number = {7956},
  pages = {259--265},
  doi = {10.1038/s41586-023-05881-4}
}

@article{boiko2023autonomous,
  author = {Boiko, Daniil A. and MacKnight, Robert and Kline, Ben and Gomes, Gabe},
  title = {Autonomous chemical research with large language models},
  journal = {Nature},
  year = {2023},
  volume = {624},
  number = {7992},
  pages = {570--578},
  doi = {10.1038/s41586-023-06792-0}
}

@article{bran2024augmenting,
  author = {Bran, Andres M. and Cox, Sam and Schilter, Oliver and Baldassari, Carlo and White, Andrew D. and Schwaller, Philippe},
  title = {Augmenting large language models with chemistry tools},
  journal = {Nature Machine Intelligence},
  year = {2024},
  volume = {6},
  number = {5},
  pages = {525--535},
  doi = {10.1038/s42256-024-00832-8}
}

@inproceedings{jimenez2024swebench,
  author = {Jimenez, Carlos E. and Yang, John and Wettig, Alexander and Yao, Shunyu and Pei, Kexin and Press, Ofir and others},
  title = {{SWE}-bench: Can language models resolve real-world {GitHub} issues?},
  booktitle = {International Conference on Learning Representations (ICLR)},
  year = {2024},
  note = {arXiv:2310.06770}
}

@inproceedings{schick2023toolformer,
  author = {Schick, Timo and Dwivedi-Yu, Jane and Dess{\\`i}, Roberto and Raileanu, Roberta and Lomeli, Maria and Zettlemoyer, Luke and others},
  title = {Toolformer: Language models can teach themselves to use tools},
  booktitle = {Advances in Neural Information Processing Systems (NeurIPS)},
  year = {2023},
  volume = {36},
  pages = {68539--68551}
}

@misc{lu2024aiscientist,
  author = {Lu, Chris and Lu, Cong and Lange, Robert Tjarko and Foerster, Jakob and Clune, Jeff and Ha, David},
  title = {The {AI} Scientist: Towards fully automated open-ended scientific discovery},
  year = {2024},
  howpublished = {arXiv preprint},
  note = {arXiv:2408.06292}
}

@article{huang2023survey,
  author = {Huang, Lei and Yu, Weijiang and Ma, Weitao and Zhong, Weihong and Feng, Zhangyin and Wang, Haotian and others},
  title = {A survey on hallucination in large language models: Principles, taxonomy, challenges, and open questions},
  journal = {ACM Computing Surveys},
  year = {2023},
  volume = {56},
  number = {12},
  pages = {1--37},
  doi = {10.1145/3702114}
}

@article{ji2023survey,
  author = {Ji, Ziwei and Lee, Nayeon and Frieske, Rita and Yu, Tiezheng and Su, Dan and Xu, Yan and others},
  title = {Survey of hallucination in natural language generation},
  journal = {ACM Computing Surveys},
  year = {2023},
  volume = {55},
  number = {12},
  pages = {1--38},
  doi = {10.1145/3571730}
}

@article{alberts2015selfcorrection,
  author = {Alberts, Bruce and Cicerone, Ralph J. and Fienberg, Stephen E. and Kamb, Alexander and McNutt, Marcia and Nerem, Robert M. and others},
  title = {Self-correction in science at work},
  journal = {Science},
  year = {2015},
  volume = {348},
  number = {6242},
  pages = {1420--1422},
  doi = {10.1126/science.aab3847}
}

@article{karpievitch2010liquid,
  author = {Karpievitch, Yuliya V. and Polpitiya, Ashoka D. and Anderson, Gordon A. and Smith, Richard D. and Dabney, Alan R.},
  title = {Liquid chromatography-mass spectrometry-based proteomics: Biological and technological aspects of data analysis},
  journal = {Bioinformatics},
  year = {2010},
  volume = {26},
  number = {19},
  pages = {2497--2504},
  doi = {10.1093/bioinformatics/btq445}
}

@article{benjamini1995controlling,
  author = {Benjamini, Yoav and Hochberg, Yosef},
  title = {Controlling the false discovery rate: a practical and powerful approach to multiple testing},
  journal = {Journal of the Royal Statistical Society: Series B (Methodological)},
  year = {1995},
  volume = {57},
  number = {1},
  pages = {289--300},
  doi = {10.1111/j.2517-6161.1995.tb02031.x}
}

@article{walters2023fabrication,
  author = {Walters, William H. and Wilder, Esther Isabelle},
  title = {Fabrication and errors in the bibliographic citations generated by {ChatGPT}},
  journal = {Scientific Reports},
  year = {2023},
  volume = {13},
  number = {1},
  pages = {14045},
  doi = {10.1038/s41598-023-41407-7}
}

@article{liu2024lost,
  author = {Liu, Nelson F. and Lin, Kevin and Hewitt, John and Paranjape, Ashwin and Bevilacqua, Michele and Petroni, Fabio and others},
  title = {Lost in the middle: How language models use long contexts},
  journal = {Transactions of the Association for Computational Linguistics},
  year = {2024},
  volume = {12},
  pages = {157--173},
  doi = {10.1162/tacl_a_00638}
}

@misc{chen2021evaluating,
  author = {Chen, Mark and Tworek, Jerry and Jun, Heewoo and Yuan, Qiming and Pinto, Henrique Ponde de Oliveira and Kaplan, Jared and others},
  title = {Evaluating large language models trained on code},
  year = {2021},
  howpublished = {arXiv preprint},
  note = {arXiv:2107.03374}
}

@misc{anthropic2024mcp,
  author = {{Anthropic}},
  title = {Model Context Protocol Specification},
  year = {2024},
  howpublished = {Anthropic Documentation},
  note = {Available from: \\url{https://modelcontextprotocol.io} [Accessed 2 Nov 2025]}
}

@article{meyer2012emerging,
  author = {Meyer, Hemmo and Bug, Marion and Bremer, Steffen},
  title = {Emerging functions of the {VCP/p97} {AAA-ATPase} in the ubiquitin system},
  journal = {Nature Cell Biology},
  year = {2012},
  volume = {14},
  number = {2},
  pages = {117--123},
  doi = {10.1038/ncb2407}
}

@article{vandenboom2018vcp,
  author = {van den Boom, Juliane and Meyer, Hemmo},
  title = {{VCP/p97}-Mediated Unfolding as a Principle in Protein Homeostasis and Signaling},
  journal = {Molecular Cell},
  year = {2018},
  volume = {69},
  number = {2},
  pages = {182--194},
  doi = {10.1016/j.molcel.2017.10.028}
}

@article{christianson2012defining,
  author = {Christianson, John C. and Olzmann, James A. and Shaler, Thomas A. and Sowa, Matthew E. and Bennett, Eric J. and Richter, Christian M. and others},
  title = {Defining human {ERAD} networks through an integrative mapping strategy},
  journal = {Nature Cell Biology},
  year = {2012},
  volume = {14},
  number = {1},
  pages = {93--105},
  doi = {10.1038/ncb2383}
}

@article{leitman2014herp,
  author = {Leitman, Julia and Shenkman, Marina and Gofman, Yael and Shtern, Nitsan and Benyair, Ron and Hendershot, Linda M. and others},
  title = {Herp binds confirmational intermediates of {ERAD} substrates and regulates their delivery to the proteasome},
  journal = {Molecular Biology of the Cell},
  year = {2014},
  volume = {25},
  number = {20},
  pages = {3050--3060},
  doi = {10.1091/mbc.E14-03-0842}
}

@article{radhakrishnan2010transcription,
  author = {Radhakrishnan, Senthil K. and Lee, Chun-Song and Young, Philip and Beskow, Andrey and Chan, Jefferson Y. and Deshaies, Raymond J.},
  title = {Transcription factor {Nrf1} mediates the proteasome recovery pathway after proteasome inhibition in mammalian cells},
  journal = {Molecular Cell},
  year = {2010},
  volume = {38},
  number = {1},
  pages = {17--28},
  doi = {10.1016/j.molcel.2010.02.029}
}

@article{koizumi2016aspartyl,
  author = {Koizumi, Shunsuke and Irie, Takao and Hirayama, Saki and Sakurai, Yasushi and Yashiroda, Hideki and Naguro, Isao and others},
  title = {The aspartyl protease {DDI2} activates {Nrf1} to compensate for proteasome dysfunction},
  journal = {eLife},
  year = {2016},
  volume = {5},
  pages = {e18357},
  doi = {10.7554/eLife.18357}
}

@article{wilkinson2016fair,
  author = {Wilkinson, Mark D. and Dumontier, Michel and Aalbersberg, I. J. and Appleton, Gabrielle and Axton, Myles and Baak, Arie and others},
  title = {The {FAIR} Guiding Principles for scientific data management and stewardship},
  journal = {Scientific Data},
  year = {2016},
  volume = {3},
  pages = {160018},
  doi = {10.1038/sdata.2016.18}
}

@misc{icmje2024authorship,
  author = {{International Committee of Medical Journal Editors}},
  title = {Defining the Role of Authors and Contributors},
  howpublished = {ICMJE Recommendations},
  year = {2024},
  note = {Available from: \\url{https://www.icmje.org/recommendations/browse/roles-and-responsibilities/defining-the-role-of-authors-and-contributors.html} [Accessed 2 Nov 2025]}
}
"""

with open(os.path.join(OVERLEAF_DIR, "references.bib"), "w") as f:
    f.write(BIB_CONTENT.strip() + "\n")

# Citation map
CITE_MAP = {
    r"\[1, 2\]": r"\cite{jones2023tidyproteomics, aebersold2016mass}",
    r"\[3\]": r"\cite{cox2008maxquant}",
    r"\[4\]": r"\cite{demichev2020diann}",
    r"\[1, 5\]": r"\cite{jones2023tidyproteomics, nesvizhskii2014proteomics}",
    r"\[6\]": r"\cite{wang2019deep}",
    r"\[1, 7\]": r"\cite{jones2023tidyproteomics, karpievitch2012normalization}",
    r"\[8, 9\]": r"\cite{lazar2016accounting, wei2018missing}",
    r"\[8, 10\]": r"\cite{lazar2016accounting, willforss2019normalyzerde}",
    r"\[11\]": r"\cite{ritchie2015limma}",
    r"\[12\]": r"\cite{korotkevich2021fgsea}",
    r"\[13\]": r"\cite{tyanova2016perseus}",
    r"\[1, 14\]": r"\cite{jones2023tidyproteomics, peng2011reproducible}",
    r"\[15\]": r"\cite{choi2014msstats}",
    r"\[16\]": r"\cite{zhang2018proteomewide}",
    r"\[1, 15\]": r"\cite{jones2023tidyproteomics, choi2014msstats}",
    r"\[17\]": r"\cite{wickham2019welcome}",
    r"\[18\]": r"\cite{altmetric2024tidyproteomics}",
    r"\[1, 19\]": r"\cite{jones2023tidyproteomics, gatto2014assessing}",
    r"\[19[–-]21\]": r"\cite{gatto2014assessing, mangul2019systematic, batut2018community}",
    r"\[22[–-]28\]": r"\cite{singhal2023large, moor2023foundation, boiko2023autonomous, bran2024augmenting, jimenez2024swebench, schick2023toolformer, lu2024aiscientist}",
    r"\[29[–-]31\]": r"\cite{huang2023survey, ji2023survey, alberts2015selfcorrection}",
    r"\[29, 32, 33\]": r"\cite{huang2023survey, karpievitch2010liquid, benjamini1995controlling}",
    r"\[35\]": r"\cite{liu2024lost}",
    r"\[26, 36\]": r"\cite{jimenez2024swebench, chen2021evaluating}",
    r"\[37\]": r"\cite{anthropic2024mcp}",
    r"\[38, 39\]": r"\cite{meyer2012emerging, vandenboom2018vcp}",
    r"\[40, 41\]": r"\cite{christianson2012defining, leitman2014herp}",
    r"\[42, 43\]": r"\cite{radhakrishnan2010transcription, koizumi2016aspartyl}",
    r"\[44\]": r"\cite{wilkinson2016fair}",
    r"\[45\]": r"\cite{icmje2024authorship}"
}

print("References written. Now building LaTeX...")
