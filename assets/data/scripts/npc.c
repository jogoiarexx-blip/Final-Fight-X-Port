
void main()
{
    {
        clearspawnentry();
        setspawnentry("name", "guy_npc");       
        setspawnentry("coords", -100, 195, 0);  
        spawn();

        setspawnentry("name", "cody_npc");      
        setspawnentry("coords", -100, 200, 0);  
        spawn();

        setspawnentry("name", "haggar_npc");    
        setspawnentry("coords", -100, 205, 0);  
        spawn();
    }
}
