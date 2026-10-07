/** Explicit equivalents only: related technologies are different skills. */
(() => {
    const groups = [
        ['JavaScript','JS','ECMAScript'], ['TypeScript','TS'],
        ['React','React.js','ReactJS'], ['Node.js','NodeJS'], ['Vue.js','VueJS','Vue'],
        ['Angular','Angular (Framework)'], ['AngularJS','Angular.js'],
        ['Next.js','NextJS'], ['Nuxt.js','NuxtJS'], ['Express.js','ExpressJS','Express'],
        ['C#','C Sharp','C-Sharp'], ['C++','CPP'], ['F#','F Sharp'],
        ['Java','Java (Programming Language)'], ['Go','Golang','Go (Programming Language)'],
        ['Python','Python (Programming Language)'], ['Ruby','Ruby (Programming Language)'],
        ['Kotlin','Kotlin (Programming Language)'], ['Rust','Rust (Programming Language)'],
        ['.NET','DotNet','Dot Net'], ['ASP.NET','ASP Dot Net'],
        ['Spring Boot','SpringBoot'], ['PostgreSQL','Postgres'], ['MongoDB','Mongo DB'],
        ['Microsoft SQL Server','MS SQL Server','MSSQL'], ['Microsoft Excel','MS Excel'],
        ['Amazon Web Services','AWS'], ['Google Cloud Platform','GCP','Google Cloud'],
        ['Microsoft Azure','Azure'], ['Kubernetes','K8s'],
        ['Apache Kafka','Kafka'], ['Apache Spark','Spark'], ['Apache Hadoop','Hadoop'],
        ['Elasticsearch','Elastic Search'], ['RabbitMQ','Rabbit MQ'],
        ['GitHub Actions','GithubActions'], ['Continuous Integration','CI'],
        ['CI/CD','CI CD'],
        ['Object Oriented Programming','Object-Oriented Programming','OOP'],
        ['REST API','REST APIs','RESTful API','RESTful APIs'],
        ['HTML','HTML (Hypertext Markup Language)'], ['CSS','Cascading Style Sheets'],
        ['Artificial Intelligence','AI'], ['Machine Learning','ML'],
        ['Natural Language Processing','NLP'], ['Large Language Models','LLM','LLMs']
    ];
    const normalize = value => String(value ?? '').trim().toLowerCase().replace(/\s+/g,' ');
    const index = new Map();
    const searchNames = new Map();
    for (const group of groups) for (const label of group) {
        index.set(normalize(label),normalize(group[0]));searchNames.set(normalize(label),group[0]);
    }
    const canonical = label => index.get(normalize(label)) || normalize(label);
    globalThis.SkillAliases = {groups,canonical,searchTerm:label=>searchNames.get(normalize(label)) || String(label).trim(),matches:(a,b)=>canonical(a)===canonical(b)};
})();
