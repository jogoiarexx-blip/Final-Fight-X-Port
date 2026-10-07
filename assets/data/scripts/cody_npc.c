
void suicide()
{
    int i;
    void p;
    for(i=0; i<3; i++)
    {
        p = getplayerproperty(i, "ent");
        if(p!=NULL())
        {
            if(getentityproperty(p, "name")=="cody")
            {
                killentity(getlocalvar("self"));
                setglobalvar("cody_npc", NULL());
                break;
            }
        }
    }
    if(getglobalvar("inscreen")==1)
    {
        changeentityproperty(getlocalvar("self"), "subject_to_screen", 1);
    }
}

